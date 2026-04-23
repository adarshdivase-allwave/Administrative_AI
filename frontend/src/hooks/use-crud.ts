import { useCallback, useEffect, useState } from "react";
import { api, type Schema } from "@/lib/amplify-client";
import { toast } from "@/components/ui/toast";

/**
 * Thin wrapper around the generated Amplify data client that gives CRUD
 * pages a uniform state machine (loading / error / data) without dragging
 * in a heavier data-fetching library.
 *
 * Usage:
 *   const crud = useCrud("Vendor");
 *   crud.data    // Vendor[]
 *   crud.create({ name: "..." })
 *   crud.update("id", { name: "..." })
 *   crud.remove("id")
 */

type ModelName = keyof Schema;
type ListFilter = Record<string, unknown>;

interface ClientModel {
  list: (args?: { filter?: ListFilter; limit?: number }) => Promise<{ data?: unknown[] }>;
  get: (args: { id: string }) => Promise<{ data?: unknown }>;
  create: (input: Record<string, unknown>) => Promise<{ data?: unknown; errors?: unknown }>;
  update: (input: Record<string, unknown>) => Promise<{ data?: unknown; errors?: unknown }>;
  delete: (args: { id: string }) => Promise<{ data?: unknown; errors?: unknown }>;
  observeQuery?: (args?: { filter?: ListFilter }) => {
    subscribe: (h: { next: (x: { items?: unknown[] }) => void; error?: () => void }) => {
      unsubscribe: () => void;
    };
  };
}

export interface CrudApi<T = unknown> {
  data: T[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (input: Record<string, unknown>) => Promise<T | null>;
  update: (id: string, input: Record<string, unknown>) => Promise<T | null>;
  remove: (id: string) => Promise<boolean>;
}

export function useCrud<T = unknown>(
  modelName: ModelName,
  opts: { filter?: ListFilter; limit?: number; liveSubscribe?: boolean } = {},
): CrudApi<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const model = (api.models as unknown as Record<string, ClientModel>)[modelName as string];
      if (!model) throw new Error(`Model ${String(modelName)} not found on Amplify client`);
      const res = await model.list({ filter: opts.filter, limit: opts.limit ?? 500 });
      setData((res.data ?? []) as T[]);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [modelName, opts.filter, opts.limit]);

  useEffect(() => {
    void reload();

    if (!opts.liveSubscribe) return;
    const model = (api.models as unknown as Record<string, ClientModel>)[modelName as string];
    const sub = model?.observeQuery?.({ filter: opts.filter })?.subscribe({
      next: ({ items }) => setData((items ?? []) as T[]),
      error: () => undefined,
    });
    return () => sub?.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelName, JSON.stringify(opts.filter), opts.liveSubscribe]);

  const create = useCallback<CrudApi<T>["create"]>(
    async (input) => {
      try {
        const model = (api.models as unknown as Record<string, ClientModel>)[modelName as string];
        if (!model) throw new Error(`Model ${String(modelName)} not found`);
        const res = await model.create(input as Record<string, unknown>);
        if (res.errors) throw normalizeErrors(res.errors);
        const created = res.data as T | undefined;
        if (created) {
          setData((prev) => [created, ...prev]);
          toast.success("Saved");
        }
        return created ?? null;
      } catch (e) {
        toast.error(friendlyError(e));
        return null;
      }
    },
    [modelName],
  );

  const update = useCallback<CrudApi<T>["update"]>(
    async (id, input) => {
      try {
        const model = (api.models as unknown as Record<string, ClientModel>)[modelName as string];
        if (!model) throw new Error(`Model ${String(modelName)} not found`);
        const res = await model.update({ id, ...input });
        if (res.errors) throw normalizeErrors(res.errors);
        const updated = res.data as T | undefined;
        if (updated) {
          setData((prev) =>
            prev.map((r) => ((r as { id?: string }).id === id ? { ...r, ...updated } : r)),
          );
          toast.success("Updated");
        }
        return updated ?? null;
      } catch (e) {
        toast.error(friendlyError(e));
        return null;
      }
    },
    [modelName],
  );

  const remove = useCallback<CrudApi<T>["remove"]>(
    async (id) => {
      try {
        const model = (api.models as unknown as Record<string, ClientModel>)[modelName as string];
        if (!model) throw new Error(`Model ${String(modelName)} not found`);
        const res = await model.delete({ id });
        if (res.errors) throw normalizeErrors(res.errors);
        setData((prev) => prev.filter((r) => (r as { id?: string }).id !== id));
        toast.success("Deleted");
        return true;
      } catch (e) {
        toast.error(friendlyError(e));
        return false;
      }
    },
    [modelName],
  );

  return { data, loading, error, reload, create, update, remove };
}

function friendlyError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/not authorized/i.test(msg)) return "You don't have permission for this action.";
  if (/ConditionalCheckFailed/i.test(msg))
    return "That change conflicts with the current record. Refresh and try again.";
  if (/NetworkError|Failed to fetch/i.test(msg))
    return "Can't reach the backend. Check your connection and that ampx sandbox is running.";
  return msg.replace(/^GraphQL error:\s*/i, "");
}

function normalizeErrors(errors: unknown): Error {
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as { message?: string } | undefined;
    return new Error(first?.message ?? "Unknown GraphQL error");
  }
  return new Error(String(errors));
}
