export function sum(xs: number[]) {
  let t = 0;
  for (const x of xs) t += x;
  return t;
}

export const pattern = /'(?:[^'\\]|\\.)*'/g;

export function greet(name: string) {
  return `hello ${name}, it's ${new Date().getFullYear()}`;
}
