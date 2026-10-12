/** Pulls a JSON value out of model text: strips ``` fences and any prose around the outermost object/array. */
export function extractJson(text: string): unknown {
  let s = text.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence?.[1] !== undefined) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.search(/[{[]/);
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (start === -1 || end <= start) throw new SyntaxError('No JSON object found in model output');
    return JSON.parse(s.slice(start, end + 1));
  }
}
