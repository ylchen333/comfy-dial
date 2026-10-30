// Prompt helpers for the Generate page (no UI): examples, limits, and a warning for camera words.
// The server holds the same limits (apps/server/src/prompt.ts); keep them in step.
export const MAX_PROMPT = 600;
export const MAX_NEGATIVE = 300;
/** The demo prompt: the dancing baby in the Huangshan mountains, the ink-robed swordsman beside it, wind blowing. No camera words; the depth guide moves the camera. */
export const DEMO_PROMPT = "A happy baby in a small red cloth wrap dances on a stone stair high in the Huangshan mountains, tiny arms swaying and feet stepping to a rhythm. Beside the baby a lone swordsman in black and white ink-wash robes stands guard. A gentle mountain wind blows: robes and sleeves flutter, pine branches sway, and a sea of mist drifts between the granite spires. Soft overcast morning light, muted ink-painting palette, cinematic, realistic fabric motion.";
/** The earlier demo prompt: the swordsman is the subject, the baby a bystander. */
export const HERO_PROMPT = "A lone swordsman in layered black and white ink-wash robes stands on a stone stair above the granite spires of Huangshan, a sea of mist drifting below. A strong mountain wind blows across the peak: his long black hair, torn sheer sleeves and the hem of his robe stream sideways, pine branches sway, and thin cloud races between the rocks. Soft overcast morning light, muted ink-painting palette, cinematic, realistic fabric motion. Beside him a small baby in a red cloth wrap dances, arms swaying.";
export const DEFAULT_PROMPT = DEMO_PROMPT;
export const DEFAULT_NEGATIVE = "pc game, console game, video game, cartoon, childish, ugly";

/** Characters with something to do, in a place and a light. SFW, no real people, no brands. No camera words: the depth guide moves the camera. */
export const PROMPT_EXAMPLES: readonly { label: string; text: string }[] = [
  { label: "Dancing baby", text: DEMO_PROMPT },
  { label: "Huangshan hero", text: HERO_PROMPT },
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
