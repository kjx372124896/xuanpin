import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { clearSessionQueries } from "./session-cache";

test("切换账号后清除新鲜收藏和管理员缓存，迟到的旧请求不能重新填充缓存", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: false } } });
  try {
    const key = ["products", { favoritesOnly: true }];
    client.setQueryData(key, { owner: "A", items: ["A-favorite"] });
    client.setQueryData(["adminUsers"], ["private-admin-data"]);
    let resolveOld!: (value: unknown) => void;
    const pending = client.fetchQuery({ queryKey: ["old-request"], queryFn: () => new Promise((resolve) => { resolveOld = resolve; }) }).catch(() => undefined);
    await clearSessionQueries(client);
    resolveOld({ owner: "A" });
    await pending;
    assert.equal(client.getQueryCache().getAll().length, 0);
    let requests = 0;
    const result = await client.fetchQuery({ queryKey: key, queryFn: async () => { requests += 1; return { owner: "B", items: [] }; } });
    assert.equal(requests, 1);
    assert.equal(result.owner, "B");
    assert.deepEqual(result.items, []);
  } finally { client.clear(); }
});
