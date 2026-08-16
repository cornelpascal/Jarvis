import { randomUUID } from "node:crypto";
import {
  EVENT_SCHEMA_VERSION,
  jarvisEventSchema,
  type JarvisEvent,
} from "@jarvis/protocol";

export type EventListener = (event: JarvisEvent) => void | Promise<void>;

export class LocalEventBus {
  readonly #listeners = new Set<EventListener>();
  #sequence = 0;

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  create<T>(type: string, source: string, payload: T): JarvisEvent<T> {
    return jarvisEventSchema.parse({
      id: randomUUID(),
      sequence: this.#sequence++,
      timestamp: new Date().toISOString(),
      type,
      source,
      schemaVersion: EVENT_SCHEMA_VERSION,
      payload,
    }) as JarvisEvent<T>;
  }

  async publish(event: JarvisEvent): Promise<void> {
    const validated = jarvisEventSchema.parse(event) as JarvisEvent;
    await Promise.all(
      [...this.#listeners].map(async (listener) => listener(validated)),
    );
  }
}
