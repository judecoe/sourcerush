/**
 * Hardcoded source + questions for the "Try it yourself" room
 * (`createRoom({ sample: true })`), which runs the real pipeline with
 * SAMPLE_PIPELINE_DEPS below instead of Firecrawl + Anthropic. The article
 * is original and fictional (written for this project), so there are no
 * copyright or accuracy concerns.
 *
 * Every `passage` must appear verbatim in `FIXTURE_SOURCE.text`;
 * fixtures.test.ts checks that all 8 pass validateQuestions.
 */

import type { PipelineDeps } from './pipeline'
import type { PromptInput } from './prompt'

export const FIXTURE_SOURCE: PromptInput = {
  title: 'The Tide Clock of Wenmouth Harbour',
  text: `The Tide Clock of Wenmouth Harbour

For most of its history, the small fishing town of Wenmouth had no reliable way to know when the harbour would be deep enough for its boats. The channel into the harbour was shallow, and a boat that left too early could run aground on the sandbar at its mouth.

In 1871 a retired ship's carpenter named Edda Pryce proposed a solution. Instead of a written tide table, which most fishermen in the town could not read, she wanted a large clock face mounted on the harbour wall that would show the state of the tide with a single hand.

The town council rejected her first design because it relied on a float in a well beneath the wall, and the council feared the well would fill with silt. Pryce spent the following winter redesigning the mechanism so that the float sat inside a copper tube that could be lifted out and cleaned.

The second design was approved in the spring of 1873, and the clock was built over the summer by Pryce and two apprentices. The town paid for the copper, while the iron gears were donated by a foundry in the neighbouring town of Hallow Cross.

The clock face was painted in three colours. A red band meant the channel was too shallow for any loaded boat, a yellow band meant only small boats should attempt the crossing, and a green band meant the harbour was open to the whole fleet.

Fishermen soon learned to read the clock from far out at sea using a brass telescope that the harbour master kept for that purpose. Within five years, records kept by the harbour master show that groundings on the sandbar had fallen from roughly a dozen a year to two.

The clock was badly damaged in the storm of 1902, when waves broke over the harbour wall and bent the copper tube. Rather than replace it, the town repaired the original mechanism, and the bent section of tube is still displayed in the Wenmouth museum.

Today the harbour has an electronic depth gauge, but the tide clock still runs. Volunteers from the Wenmouth Harbour Society clean the copper tube every April, a tradition that began in 1950 when the society was founded.`,
}

/** Shaped like model output: validateQuestions() takes `unknown[]`. */
export const FIXTURE_CANDIDATES: unknown[] = [
  {
    prompt: 'Why did Edda Pryce want a clock face instead of a written tide table?',
    choices: [
      'Most fishermen in the town could not read a written table',
      'Written tables were too expensive to print each year',
      'The council had banned printed notices on the harbour wall',
      'Tide tables were often wrong for the Wenmouth channel',
    ],
    correctIndex: 0,
    passage:
      'Instead of a written tide table, which most fishermen in the town could not read, she wanted a large clock face mounted on the harbour wall that would show the state of the tide with a single hand.',
    explanation: 'The article says most fishermen could not read a written tide table.',
  },
  {
    prompt: 'Why did the town council reject the first design of the tide clock?',
    choices: [
      'It needed more copper than the town could afford',
      'They feared the well beneath the float would fill with silt',
      'The clock face would be too small to read from sea',
      'Pryce had no apprentices to help build it',
    ],
    correctIndex: 1,
    passage:
      'The town council rejected her first design because it relied on a float in a well beneath the wall, and the council feared the well would fill with silt.',
    explanation: 'The council worried the well holding the float would silt up.',
  },
  {
    prompt: 'How did Pryce change the mechanism in her second design?',
    choices: [
      'She replaced the float with a set of iron weights',
      'She moved the clock to the top of the lighthouse',
      'She put the float inside a copper tube that could be lifted out and cleaned',
      'She added a second hand to show the time of day',
    ],
    correctIndex: 2,
    passage:
      'Pryce spent the following winter redesigning the mechanism so that the float sat inside a copper tube that could be lifted out and cleaned.',
    explanation: 'A removable copper tube solved the silting problem the council raised.',
  },
  {
    prompt: 'Who supplied the iron gears for the tide clock?',
    choices: [
      'The Wenmouth town council',
      'A foundry in the neighbouring town of Hallow Cross',
      'The Wenmouth Harbour Society',
      'The harbour master',
    ],
    correctIndex: 1,
    passage:
      'The town paid for the copper, while the iron gears were donated by a foundry in the neighbouring town of Hallow Cross.',
    explanation: 'The gears were donated by a foundry in Hallow Cross; the town paid only for the copper.',
  },
  {
    prompt: 'What did a yellow band on the clock face tell fishermen?',
    choices: [
      'The harbour was open to the whole fleet',
      'No loaded boat should attempt the channel',
      'A storm was expected within the day',
      'Only small boats should attempt the crossing',
    ],
    correctIndex: 3,
    passage:
      'A red band meant the channel was too shallow for any loaded boat, a yellow band meant only small boats should attempt the crossing, and a green band meant the harbour was open to the whole fleet.',
    explanation: 'Yellow meant only small boats should cross; red and green meant closed and open.',
  },
  {
    prompt: 'What happened to groundings on the sandbar within five years of the clock being built?',
    choices: [
      'They fell from roughly a dozen a year to two',
      'They stopped completely',
      'They stayed the same but caused less damage',
      'They rose because more boats used the harbour',
    ],
    correctIndex: 0,
    passage:
      'Within five years, records kept by the harbour master show that groundings on the sandbar had fallen from roughly a dozen a year to two.',
    explanation: "The harbour master's records show groundings fell from about twelve a year to two.",
  },
  {
    prompt: 'What did the town do after the storm of 1902 damaged the clock?',
    choices: [
      'It replaced the clock with an electronic depth gauge',
      'It built a new clock further from the harbour wall',
      'It repaired the original mechanism rather than replacing it',
      'It moved the clock into the Wenmouth museum',
    ],
    correctIndex: 2,
    passage:
      'Rather than replace it, the town repaired the original mechanism, and the bent section of tube is still displayed in the Wenmouth museum.',
    explanation: 'The town chose to repair the original mechanism; only the bent tube went to the museum.',
  },
  {
    prompt: 'When do volunteers from the Wenmouth Harbour Society clean the copper tube?',
    choices: [
      'After every major storm',
      'Every April',
      'On the anniversary of the 1873 approval',
      'Whenever the depth gauge fails',
    ],
    correctIndex: 1,
    passage:
      'Volunteers from the Wenmouth Harbour Society clean the copper tube every April, a tradition that began in 1950 when the society was founded.',
    explanation: 'The article says the tube is cleaned every April, a tradition since 1950.',
  },
]

/**
 * A deliberately broken set: every passage is invented, so all fail
 * validation. Test data for pipeline.test.ts and fixtures.test.ts only.
 */
export const BROKEN_FIXTURE_CANDIDATES: unknown[] = FIXTURE_CANDIDATES.map((c) => ({
  ...(c as Record<string, unknown>),
  passage: 'This sentence does not appear anywhere in the source article.',
}))

/**
 * Fake scrape + generate for the "Try it yourself" room: no API calls, no
 * cost. They return the fixture article and candidates in the same shapes
 * the real integrations produce, so the sample goes through the same
 * cleanup, validation and shuffle as a real article.
 */
export const SAMPLE_PIPELINE_DEPS: PipelineDeps = {
  scrape: async () => ({ ok: true, title: FIXTURE_SOURCE.title, markdown: FIXTURE_SOURCE.text }),
  generate: async () => ({ ok: true, text: JSON.stringify({ questions: FIXTURE_CANDIDATES }) }),
}
