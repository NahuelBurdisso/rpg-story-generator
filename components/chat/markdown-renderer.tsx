"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  content: string;
  isNarrator?: boolean;
}

/**
 * Detect if a paragraph is NPC dialogue — starts with a quoted string
 * like: "Hello there," the merchant said.
 * or:  "Run!" she screamed.
 */
function isDialogueParagraph(children: React.ReactNode): boolean {
  if (!children) return false;
  const arr = Array.isArray(children) ? children : [children];
  const first = arr[0];
  if (typeof first === "string") {
    const trimmed = first.trimStart();
    return /^[\u201C"\u00AB]/.test(trimmed);
  }
  return false;
}

function buildComponents(isNarrator: boolean): Components {
  return {
    a({ href, children }) {
      const isCharacterLink = href?.includes("/characters/");
      if (isCharacterLink) {
        return (
          <a
            href={href}
            className="text-amber-400/90 hover:text-amber-300 underline decoration-amber-600/40 hover:decoration-amber-400/60 underline-offset-2 transition-colors cursor-pointer font-medium"
          >
            {children}
          </a>
        );
      }
      return <a href={href} className="text-zinc-400 underline">{children}</a>;
    },
    strong({ children }) {
      return <strong className="text-amber-300 font-semibold">{children}</strong>;
    },
    em({ children }) {
      return <em className="text-zinc-300 italic">{children}</em>;
    },
    blockquote({ children }) {
      return (
        <div className="action-blockquote">
          {children}
        </div>
      );
    },
    p({ children }) {
      if (isNarrator && isDialogueParagraph(children)) {
        return (
          <p className="npc-dialogue mb-2 last:mb-0 leading-relaxed">{children}</p>
        );
      }
      return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
    },
    ul({ children }) {
      return <ul className="list-disc list-inside mb-2 space-y-0.5 text-zinc-300">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="list-decimal list-inside mb-2 space-y-0.5 text-zinc-300">{children}</ol>;
    },
    li({ children }) {
      return <li className="text-sm">{children}</li>;
    },
    h1({ children }) {
      if (isNarrator) {
        return <h1 className="scene-header text-base">{children}</h1>;
      }
      return <h1 className="text-lg font-bold text-zinc-100 mb-1 mt-2">{children}</h1>;
    },
    h2({ children }) {
      if (isNarrator) {
        return <h2 className="scene-header">{children}</h2>;
      }
      return <h2 className="text-base font-bold text-zinc-100 mb-1 mt-2">{children}</h2>;
    },
    h3({ children }) {
      if (isNarrator) {
        return <h3 className="scene-header text-[0.7rem]">{children}</h3>;
      }
      return <h3 className="text-sm font-bold text-zinc-200 mb-1 mt-1.5">{children}</h3>;
    },
    hr() {
      if (isNarrator) {
        return (
          <div className="scene-divider" role="separator">
            <span className="text-[10px] tracking-[0.3em] font-serif opacity-60">&#x2726;&#x2726;&#x2726;</span>
          </div>
        );
      }
      return <hr className="my-3 border-zinc-800" />;
    },
    code({ className, children }) {
      const isInline = !className;
      if (isInline) {
        return (
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-amber-200/80">
            {children}
          </code>
        );
      }
      return (
        <code className={`block rounded bg-zinc-900 border border-zinc-800 p-2 text-xs font-mono text-zinc-300 overflow-x-auto my-2 ${className ?? ""}`}>
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <pre className="my-2">{children}</pre>;
    },
    table({ children }) {
      return (
        <div className="overflow-x-auto my-2">
          <table className="w-full text-sm border-collapse">{children}</table>
        </div>
      );
    },
    th({ children }) {
      return (
        <th className="border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-left text-xs font-medium text-zinc-300">
          {children}
        </th>
      );
    },
    td({ children }) {
      return (
        <td className="border border-zinc-800 px-2 py-1 text-xs text-zinc-400">
          {children}
        </td>
      );
    },
  };
}

export function MarkdownRenderer({ content, isNarrator = false }: MarkdownRendererProps) {
  const components = useMemo(() => buildComponents(isNarrator), [isNarrator]);

  return (
    <div className={isNarrator ? "text-[0.9rem]" : "text-sm"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
