// Release versions, compared: '0.10.1' is newer than '0.9.3'. A leading v
// and any pre-release suffix are ignored.
export function newer(a, b) {
  const parts = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}
