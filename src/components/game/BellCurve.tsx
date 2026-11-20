/**
 * The day's scores as a bell curve, with lines for the average and your score.
 *
 * Clients never see other players' scores, only an average and spread (the
 * ones saved when you finished), so this is a normal curve fitted to those
 * two numbers (bellCurvePoints), not a plot of real scores. Plain SVG, colored
 * with theme tokens through currentColor so it follows light/dark mode.
 */

import { bellCurvePoints } from '@/lib/daily'

type Props = {
  mean: number
  stdDev: number
  /** Highest possible score (questions × 1000): the right end of the axis. */
  maxScore: number
  myScore?: number
}

const W = 320
const H = 140
const PAD_X = 8
const TOP = 22 // room for the marker labels
const BASE = 118 // y of the axis line

export function BellCurve({ mean, stdDev, maxScore, myScore }: Props) {
  if (maxScore <= 0) return null
  const x = (score: number) => PAD_X + (Math.min(Math.max(score, 0), maxScore) / maxScore) * (W - 2 * PAD_X)
  const y = (v: number) => BASE - v * (BASE - TOP)

  const points = bellCurvePoints(mean, stdDev, maxScore)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ')
  const area = `${line} L${x(maxScore).toFixed(1)},${BASE} L${x(0).toFixed(1)},${BASE} Z`

  const avgLabelHidden = myScore !== undefined && Math.abs(x(myScore) - x(mean)) < 30

  const summary =
    `Bell curve of today's scores, average ${mean}` + (myScore !== undefined ? `, your score ${myScore}` : '') + '.'

  return (
    <svg
      data-testid="bell-curve"
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={summary}
    >
      <path d={area} className="text-primary" fill="currentColor" fillOpacity={0.12} />
      <path d={line} className="text-primary" fill="none" stroke="currentColor" strokeWidth={2} />
      <line x1={PAD_X} x2={W - PAD_X} y1={BASE} y2={BASE} className="text-border" stroke="currentColor" />

      {/* Average */}
      <g className="text-muted-foreground">
        <title>{`Average: ${mean}`}</title>
        <line x1={x(mean)} x2={x(mean)} y1={TOP} y2={BASE} stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" />
        {/* Skip the text when it would overlap "You"; the dashed line, its
            title and the Average figure below still show it. */}
        {!avgLabelHidden && (
          <text x={Math.min(Math.max(x(mean), 14), W - 14)} y={TOP - 6} textAnchor="middle" fontSize={10} fill="currentColor">
            Avg
          </text>
        )}
      </g>

      {/* You */}
      {myScore !== undefined && (
        <g data-testid="bell-curve-you" className="text-highlight">
          <title>{`You: ${myScore}`}</title>
          <line x1={x(myScore)} x2={x(myScore)} y1={TOP} y2={BASE} stroke="currentColor" strokeWidth={2} />
          <circle cx={x(myScore)} cy={BASE} r={4} fill="currentColor" />
          <text
            x={Math.min(Math.max(x(myScore), 14), W - 14)}
            y={TOP - 6}
            textAnchor="middle"
            fontSize={11}
            fontWeight={700}
            fill="currentColor"
          >
            You
          </text>
        </g>
      )}

      <g className="text-muted-foreground" fontSize={10} fill="currentColor">
        <text x={PAD_X} y={BASE + 14}>
          0
        </text>
        <text x={W - PAD_X} y={BASE + 14} textAnchor="end">
          {maxScore}
        </text>
      </g>
    </svg>
  )
}
