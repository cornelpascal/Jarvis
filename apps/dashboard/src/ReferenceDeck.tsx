import { useEffect, useState } from "react";
import type { EventPayloadMap } from "@jarvis/protocol";
import { connectCore, type ConnectionState } from "./core-client";
import "./reference-deck.css";

type ReferencePayload = EventPayloadMap["reference.display.requested"];

const emptyDeck: ReferencePayload = {
  mode: "EMPTY",
  title: "REFERENCE DECK",
  items: [],
};

export function ReferenceDeck() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [deck, setDeck] = useState<ReferencePayload>(emptyDeck);
  const [error, setError] = useState<string>();

  useEffect(
    () =>
      connectCore({
        onConnection: setConnection,
        onHealth: () => undefined,
        onEvent: (event) => {
          if (event.type === "reference.display.requested")
            setDeck(event.payload);
        },
        onError: (cause) => setError(cause.message),
      }),
    [],
  );

  return (
    <main className="deck" data-mode={deck.mode.toLowerCase()}>
      <header>
        <div>
          <b>JARVIS</b>
          <span>// REFERENCE DECK</span>
        </div>
        <div>
          <span>{deck.mode}</span>
          <i className={connection} />
          {connection.toUpperCase()}
        </div>
      </header>
      <section className="deck-stage">
        {deck.items.length === 0 ? (
          <div className="deck-empty">
            <div className="deck-reticle">
              <span>R</span>
            </div>
            <h1>{deck.title ?? "REFERENCE DECK"}</h1>
            <p>{error ?? "Standing by for visual context"}</p>
          </div>
        ) : (
          <div className={`deck-grid mode-${deck.mode.toLowerCase()}`}>
            {deck.title ? <h1>{deck.title}</h1> : null}
            {deck.items.map((item) => (
              <article key={item.id}>
                {item.type === "image" && item.uri ? (
                  <img src={item.uri} alt={item.title} />
                ) : null}
                <div>
                  <small>{item.type.toUpperCase()}</small>
                  <h2>{item.title}</h2>
                  {item.content ? <pre>{item.content}</pre> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <footer>
        <span>DISPLAY CHANNEL // {connection.toUpperCase()}</span>
        <span>{String(deck.items.length).padStart(2, "0")} REFERENCES</span>
      </footer>
    </main>
  );
}
