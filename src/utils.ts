import { customAlphabet } from "nanoid";

export function* steps(
  start: number,
  end: number,
  step: number = 1,
  options: { reverse?: boolean } = {}
) {
  const { reverse = false } = options;

  if (reverse) {
    for (let i = end; i > start; i -= step) {
      yield [i - step < start ? start : i - step, i];
    }
  } else {
    for (let i = start; i < end; i += step) {
      yield [i, i + step > end ? end : i + step];
    }
  }
}

export const nanoid = customAlphabet(
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
);

export function uniqueId(prefix?: string): string {
  const baseId = nanoid(16);

  if (prefix == undefined || prefix === "") {
    return baseId;
  }

  return [prefix, baseId].join("_");
}
