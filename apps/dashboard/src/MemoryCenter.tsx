import { useCallback, useEffect, useState } from "react";
import { memorySearchResultSchema, type MemoryRecord } from "@jarvis/protocol";
import { coreRequest } from "./core-client";

export function MemoryCenter({
  projectId,
  onClose,
}: {
  projectId?: string;
  onClose: () => void;
}) {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const response = await coreRequest("/memory/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          query: "",
          scopes: projectId ? ["PROJECT", "GLOBAL"] : ["GLOBAL"],
          ...(projectId ? { projectId } : {}),
          limit: 50,
        }),
      });
      if (!response.ok)
        throw new Error(`Memory retrieval failed (${String(response.status)})`);
      setMemories(
        memorySearchResultSchema.parse(await response.json()).memories,
      );
      setError(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Memory retrieval failed",
      );
    }
  }, [projectId]);

  useEffect(() => void refresh(), [refresh]);

  const forget = async (memoryId: string): Promise<void> => {
    const response = await coreRequest("/memory/forget", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        memoryId,
        ...(projectId ? { projectId } : {}),
      }),
    });
    if (!response.ok) {
      setError(`Memory deletion failed (${String(response.status)})`);
      return;
    }
    await refresh();
  };

  return (
    <div className="modal-backdrop">
      <section className="memory-center" aria-label="Memory center">
        <div className="panel-heading">
          <h2>MEMORY CENTER</h2>
          <button onClick={onClose} type="button">
            CLOSE
          </button>
        </div>
        <p className="memory-policy">
          Showing global memories
          {projectId ? ` and ${projectId} project memories` : ""}. Session and
          ephemeral memories remain isolated to their conversation.
        </p>
        {error ? <p className="empty">{error}</p> : null}
        <div className="memory-list">
          {memories.length === 0 ? (
            <p className="empty">No memories in scope</p>
          ) : null}
          {memories.map((memory) => (
            <article key={memory.id}>
              <small>{memory.scope}</small>
              <p>{memory.content}</p>
              <button onClick={() => void forget(memory.id)} type="button">
                FORGET
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
