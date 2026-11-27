const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const { isIP } = require("node:net");
const tls = require("node:tls");

// Go resolves and checks every DNS answer with D2's netpolicy package before
// calling open. Connect directly to that numeric address without a second lookup.
exports.lookup = async (host) =>
  (await dns.lookup(host, { all: true, verbatim: true })).map((record) => record.address);

exports.open = (scheme, address, hostname, port, host, path, headers) => {
  let request;
  let chunks;
  const response = new Promise((resolve, reject) => {
    if (!isIP(address)) throw new Error("expected a resolved IP address");
    const secure = scheme === "https";
    if (!secure && scheme !== "http") throw new Error("unsupported asset URL scheme");
    const options = {
      hostname: address,
      port: port || (secure ? 443 : 80),
      path,
      headers: { ...headers, host },
      agent: false,
      maxHeaderSize: 64 * 1024,
    };
    if (secure) {
      // The socket uses the pinned IP; validate the certificate for the original host.
      options.servername = isIP(hostname) ? "" : hostname;
      options.rejectUnauthorized = true;
      options.checkServerIdentity = (_, cert) => tls.checkServerIdentity(hostname, cert);
    }
    request = (secure ? https : http).get(options, (incoming) => {
      chunks = incoming[Symbol.asyncIterator]();
      resolve({ status: incoming.statusCode, headers: incoming.rawHeaders });
    });
    request.on("error", reject);
  });
  return {
    response,
    async read() {
      const chunk = await chunks.next();
      return chunk.done ? null : chunk.value;
    },
    close() {
      request?.destroy();
    },
  };
};
