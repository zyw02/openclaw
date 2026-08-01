import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] ?? "4873");
const packageSpecs = [
  {
    name: "openclaw-policy-proof-dependency",
    version: "1.0.0",
    tarball: "openclaw-policy-proof-dependency-1.0.0.tgz",
  },
  {
    name: "openclaw-policy-proof-plugin",
    version: "1.0.0",
    tarball: "openclaw-policy-proof-plugin-1.0.0.tgz",
    openclaw: { extensions: ["./dist/index.js"] },
    dependencies: { "openclaw-policy-proof-dependency": "1.0.0" },
  },
];

const packages = packageSpecs.map((spec) => {
  const archive = fs.readFileSync(path.join(root, "artifacts", spec.tarball));
  return {
    ...spec,
    archive,
    integrity: `sha512-${crypto.createHash("sha512").update(archive).digest("base64")}`,
    shasum: crypto.createHash("sha1").update(archive).digest("hex"),
  };
});

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (request.method === "POST" && requestUrl.pathname.includes("/security/")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}\n");
    return;
  }
  if (request.method !== "GET") {
    response.writeHead(405, { "content-type": "text/plain" });
    response.end("method not allowed\n");
    return;
  }
  if (requestUrl.pathname === "/-/ping") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}\n");
    return;
  }
  for (const pkg of packages) {
    if (requestUrl.pathname === `/${pkg.name}`) {
      const baseUrl = `http://127.0.0.1:${port}`;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        `${JSON.stringify({
          name: pkg.name,
          "dist-tags": { latest: pkg.version },
          versions: {
            [pkg.version]: {
              name: pkg.name,
              version: pkg.version,
              ...(pkg.openclaw ? { openclaw: pkg.openclaw } : {}),
              ...(pkg.dependencies ? { dependencies: pkg.dependencies } : {}),
              dist: {
                integrity: pkg.integrity,
                shasum: pkg.shasum,
                tarball: `${baseUrl}/${pkg.name}/-/${pkg.tarball}`,
              },
            },
          },
        })}\n`,
      );
      return;
    }
    if (requestUrl.pathname === `/${pkg.name}/-/${pkg.tarball}`) {
      response.writeHead(200, {
        "content-length": String(pkg.archive.length),
        "content-type": "application/octet-stream",
      });
      response.end(pkg.archive);
      return;
    }
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end(`not found: ${requestUrl.pathname}\n`);
});

server.listen(port, "127.0.0.1", () => {
  process.stderr.write(`proof registry listening on http://127.0.0.1:${port}\n`);
});
