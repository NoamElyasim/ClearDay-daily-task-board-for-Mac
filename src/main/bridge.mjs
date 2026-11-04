// A local socket in the user-data folder, so ClearDay's MCP server (and so
// Claude) can reach the running app: one JSON request per line, answered in
// kind. Only this user can open it (mode 600).
import fs from 'node:fs';
import net from 'node:net';
import readline from 'node:readline';

export function startBridge(socketPath, handlers) {
  try { fs.unlinkSync(socketPath); } catch (_) {}   // left behind by a crash
  const server = net.createServer((conn) => {
    readline.createInterface({ input: conn }).on('line', async (line) => {
      let req;
      try { req = JSON.parse(line); } catch (_) { return; }
      const reply = (msg) => { if (!conn.destroyed) conn.write(JSON.stringify({ id: req.id, ...msg }) + '\n'); };
      const fn = handlers[req.method];
      if (!fn) { reply({ error: `unknown method: ${req.method}` }); return; }
      try { reply({ result: await fn(...(req.params || [])) }); } catch (e) { reply({ error: e.message }); }
    });
    conn.on('error', () => {});
  });
  server.on('error', (e) => console.error('bridge:', e.message));
  server.listen(socketPath, () => { try { fs.chmodSync(socketPath, 0o600); } catch (_) {} });
  return () => { server.close(); try { fs.unlinkSync(socketPath); } catch (_) {} };
}
