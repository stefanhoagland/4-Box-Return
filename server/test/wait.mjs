// Waits until check() is true, or the time runs out (the test's asserts then
// say what was missing). Spawning ffmpeg can be slow on a cold or busy machine.
export async function waitFor(check, ms = 15_000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
}
