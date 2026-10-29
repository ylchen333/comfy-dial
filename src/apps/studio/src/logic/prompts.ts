// Prompt helpers for the Generate page (no UI): examples, limits, and a warning for camera words.
// The server holds the same limits (apps/server/src/prompt.ts); keep them in step.
export const MAX_PROMPT = 600;
export const MAX_NEGATIVE = 300;
export const DEFAULT_PROMPT = "A cinematic shot of a single subject in a room, soft natural light, smooth steady camera motion.";
export const DEFAULT_NEGATIVE = "pc game, console game, video game, cartoon, childish, ugly";

/** Characters with something to do, in a place and a light. SFW, no real people, no brands. No camera words: the depth guide moves the camera. */
export const PROMPT_EXAMPLES: readonly { label: string; text: string }[] = [
  { label: "Woman in the rain", text: "A woman in a red wool coat walks through a rain-soaked neon street at night, reflections on wet asphalt, cinematic, shallow depth of field." },
  { label: "Chef", text: "A middle-aged chef in a white apron plates a dish in a busy restaurant kitchen, steam rising, warm practical lights." },
  { label: "Astronaut", text: "An astronaut in a worn white suit stands on a red desert ridge at dusk, dust drifting, long shadows, cinematic." },
  { label: "Samurai", text: "A samurai in dark armour stands in a bamboo forest, mist between the trees, soft morning light." },
  { label: "Dancer", text: "A dancer in a flowing blue dress spins on an empty stage, dust in the spotlight, dark theatre behind." },
];

const CAMERA = /\b(dolly|dollying|pan|panning|tilt|tilting|zoom|zooming|orbit|orbiting|tracking shot|push[- ]in|pull[- ]out|crane|handheld|steadicam|whip pan|camera)\b/gi;

/** Camera-move words in the prompt (lower case, unique). They can fight the depth guide, which already fixes the move. */
export const cameraWords = (text: string): string[] => [...new Set((text.match(CAMERA) ?? []).map((w) => w.toLowerCase()))];

/** A reason the prompt cannot be sent, or null. Empty is fine: the server then uses its default. */
export const promptProblem = (prompt: string, negative: string): string | null =>
  prompt.trim().length > MAX_PROMPT ? `prompt is ${prompt.trim().length} characters; the limit is ${MAX_PROMPT}`
  : negative.trim().length > MAX_NEGATIVE ? `avoid text is ${negative.trim().length} characters; the limit is ${MAX_NEGATIVE}`
  : null;
