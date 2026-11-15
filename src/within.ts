/** Rejects with a TimeoutError if `p` hasn't settled in `ms`. */
export async function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, no) => (t = setTimeout(() => no(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), ms)));
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

