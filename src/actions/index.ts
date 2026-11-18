/**
 * Server actions. Each one runs with the verified caller's `userId` (from the
 * JWT) and with RBAC switched off, so every check that matters is done here.
 * Never read a user id from `params`.
 */

import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionHandler, ActionTools, GetActionData, QueryActionData } from 'deepspace/worker'
import type { Env } from '../../worker'

// No 0/O or 1/I, so codes are easy to read aloud. 32 characters, so
// `byte % 32` is unbiased (256 is a multiple of 32).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const CODE_ATTEMPTS = 5

function randomRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  let code = ''
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  return code
}

/** Deterministic id for a user's row in a room (players and team_members). */
function memberRecordId(roomId: string, userId: string): string {
  return `${roomId}:${userId}`
}

/** The caller's display name, read on the server from their users row. */
async function displayNameFor(tools: ActionTools, userId: string): Promise<string> {
  const result = await tools.get('users', userId)
  if (!result.success) return 'Player'
  const name = (result.data as GetActionData).record.data.name
  return typeof name === 'string' && name.trim() ? name.trim() : 'Player'
}

/** Add the user to the room's member list, which is what grants read access. */
function addMember(tools: ActionTools, roomId: string, userId: string) {
  return tools.create(
    'team_members',
    { teamId: roomId, userId, status: 'active' },
    memberRecordId(roomId, userId),
  )
}

export const actions: Record<string, ActionHandler<Env>> = {
  /**
   * Create a room in 'lobby' with a fresh 6-character code. The caller is the
   * host: a room member, but not a player.
   * TODO: take a sourceUrl and run the question pipeline ('generating' first).
   */
  createRoom: async ({ userId, tools }) => {
    const roomId = crypto.randomUUID()

    // Codes are unique via `uniqueOn: ['code']`. On a collision the create is
    // refused with a "Duplicate: ..." error and nothing is written, so retry
    // with a new code.
    let code = ''
    for (let attempt = 1; attempt <= CODE_ATTEMPTS; attempt++) {
      code = randomRoomCode()
      const created = await tools.create(
        'rooms',
        {
          roomId,
          code,
          hostId: userId,
          status: 'lobby',
          sourceTitle: '',
          currentIndex: -1,
          answeredCount: 0,
        },
        roomId,
      )
      if (created.success) break
      if (!created.error.startsWith('Duplicate:') || attempt === CODE_ATTEMPTS) {
        console.error(`[createRoom] room create failed (attempt ${attempt}): ${created.error}`)
        return { success: false, error: 'Could not create a room. Please try again.' }
      }
      console.warn(`[createRoom] code collision on attempt ${attempt}, retrying`)
    }

    const member = await addMember(tools, roomId, userId)
    if (!member.success) {
      console.error(`[createRoom] host membership failed for room ${roomId}: ${member.error}`)
      return { success: false, error: 'Could not create a room. Please try again.' }
    }

    return { success: true, data: { roomId, code } }
  },

  /**
   * Join a room by code. A user who is already a member (host or player) gets
   * their room back whatever its status, so a rejoin or refresh always works.
   * Only new players are limited to rooms in 'lobby'.
   */
  joinRoom: async ({ userId, params, tools }) => {
    const code = typeof params.code === 'string' ? params.code.trim().toUpperCase() : ''
    if (code.length !== CODE_LENGTH) {
      return { success: false, error: 'Room codes are 6 characters.' }
    }

    const found = await tools.query('rooms', { where: { code }, limit: 1 })
    if (!found.success) {
      console.error(`[joinRoom] room lookup failed: ${found.error}`)
      return { success: false, error: 'Could not look up that room. Please try again.' }
    }
    const room = (found.data as QueryActionData).records[0]
    if (!room) return { success: false, error: 'No room with that code.' }
    const roomId = room.recordId

    // 1. Existing member? Return the room regardless of its status.
    const existing = await tools.get('team_members', memberRecordId(roomId, userId))
    if (existing.success) return { success: true, data: { roomId } }
    if (!existing.error.startsWith(RECORD_NOT_FOUND)) {
      console.error(`[joinRoom] membership lookup failed: ${existing.error}`)
      return { success: false, error: 'Could not join that room. Please try again.' }
    }

    // 2. New player: only while the room is in the lobby.
    if (room.data.status !== 'lobby') {
      return { success: false, error: 'That game has already started.' }
    }

    // Player row first, then membership: membership is what makes this
    // user count as "already joined" on a later call.
    const player = await tools.create(
      'players',
      { roomId, userId, displayName: await displayNameFor(tools, userId), score: 0 },
      memberRecordId(roomId, userId),
    )
    if (!player.success) {
      console.error(`[joinRoom] player create failed for room ${roomId}: ${player.error}`)
      return { success: false, error: 'Could not join that room. Please try again.' }
    }
    const member = await addMember(tools, roomId, userId)
    if (!member.success) {
      console.error(`[joinRoom] membership create failed for room ${roomId}: ${member.error}`)
      return { success: false, error: 'Could not join that room. Please try again.' }
    }

    return { success: true, data: { roomId } }
  },
}
