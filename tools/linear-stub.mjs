// A stand-in for Linear's API in the container smoke (MIRROR-R30), so `scheduler` runs a
// real pass without credentials and without reaching Linear. tools/container-smoke.sh
// runs it with the image's own Node and points the scheduler at it with LINEAR_API_URL,
// a name that exists for this and for tests; production never sets it.
//
// It issues one app token on POST /oauth/token and answers every GraphQL listing from a
// tiny public workspace: one team, one project status, one project. Every request leaves
// one line on stdout ("linear-stub: token" or "linear-stub: graphql <root field>"), which
// the smoke counts. Like Linear, it refuses initiatives and initiative labels with HTTP 400
// when the token was requested without `initiative:read` or `initiative:write`. Plain Node,
// no dependencies.
import { createServer } from "node:http";

// Not PORT: the image sets PORT=3000 for serve.
const port = Number(process.env.LINEAR_STUB_PORT ?? 8080);
const token = "smoke-app-token";
const at = "2026-11-01T00:00:00.000Z";
const initiativeTypes = new Set(["initiatives", "initiativeLabels"]);
/** The scopes the issued token was requested with. */
let granted = [];

const workspace = {
  teams: [
    {
      id: "smoke-team",
      name: "Smoke",
      key: "SMK",
      displayName: "Smoke",
      private: false,
      archivedAt: null,
      updatedAt: at,
      parent: null,
    },
  ],
  users: [],
  projectStatuses: [
    {
      id: "smoke-status",
      name: "Planned",
      type: "planned",
      color: "#888888",
      position: 0,
      archivedAt: null,
      updatedAt: at,
    },
  ],
  projectLabels: [],
  initiativeLabels: [],
  projects: [
    {
      id: "smoke-project",
      name: "Smoke project",
      slugId: "smoke-project",
      identifier: null,
      url: "https://linear.app/smoke/project/smoke-project",
      startDate: null,
      targetDate: null,
      priority: 0,
      health: null,
      progress: 0,
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
      completedAt: null,
      canceledAt: null,
      trashed: null,
      labelIds: [],
      lead: null,
      status: { id: "smoke-status" },
      lastUpdate: null,
      teams: { nodes: [{ id: "smoke-team" }] },
      initiatives: { nodes: [] },
    },
  ],
  initiatives: [],
};

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (req.method === "POST" && req.url === "/oauth/token") {
    console.log("linear-stub: token");
    granted = (new URLSearchParams(raw).get("scope") ?? "").split(",");
    return send(res, 200, { access_token: token, token_type: "Bearer", expires_in: 2_591_999 });
  }
  if (req.method === "POST" && req.url === "/graphql") {
    if (req.headers.authorization !== `Bearer ${token}`) {
      console.log("linear-stub: graphql unauthenticated");
      return send(res, 401, { errors: [{ extensions: { code: "AUTHENTICATION_ERROR" } }] });
    }
    const { query } = JSON.parse(raw || "{}");
    const root = /\{\s*(\w+)\(/.exec(String(query))?.[1] ?? "";
    console.log(`linear-stub: graphql ${root}`);
    if (!(root in workspace)) return send(res, 400, { errors: [{ message: `no ${root}` }] });
    if (
      initiativeTypes.has(root) &&
      !granted.includes("initiative:read") &&
      !granted.includes("initiative:write")
    ) {
      const message =
        "Invalid scope: `initiative:read` or `initiative:write` required for app user to read initiative data";
      return send(res, 400, { errors: [{ message }] });
    }
    return send(res, 200, {
      data: {
        [root]: { nodes: workspace[root], pageInfo: { hasNextPage: false, endCursor: null } },
      },
    });
  }
  send(res, 404, { error: "not found" });
});

server.listen(port, () => console.log(`linear-stub: listening on ${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
