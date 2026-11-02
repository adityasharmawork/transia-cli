import { parse } from "@babel/parser";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const traverse = require("@babel/traverse").default ?? require("@babel/traverse");

export type HookFormat = "next-intl" | "i18next";

export interface HookInsertion {
  pos: number;
  text: string;
}

export interface ImportSpec {
  module: string;
  name: string;
}

export interface HookPlan {
  /** Hook statements to insert (one per component needing one). */
  insertions: HookInsertion[];
  /** Imports to add (deduped), to be laid out by planImports. */
  importSpecs: ImportSpec[];
  /** componentPath -> the identifier apply must call (usually "t"). */
  tNameByComponent: Map<string, string>;
  /** componentPath -> reason; apply must NOT wrap sites in these components. */
  skippedComponents: Map<string, string>;
}

function parseSource(source: string) {
  return parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript", "decorators-legacy"],
    errorRecovery: true,
  });
}

function paramBindsName(param: any, name: string): boolean {
  return param?.type === "Identifier" && param.name === name;
}

/** True if `name` is bound anywhere in the function subtree (params or declarations). */
function subtreeBindsIdentifier(path: any, name: string): boolean {
  let found = false;
  for (const p of path.node.params ?? []) if (paramBindsName(p, name)) found = true;
  path.traverse({
    VariableDeclarator(vp: any) {
      if (vp.node.id?.type === "Identifier" && vp.node.id.name === name) found = true;
    },
    "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression"(fp: any) {
      for (const p of fp.node.params ?? []) if (paramBindsName(p, name)) found = true;
    },
  });
  return found;
}

function hookText(format: HookFormat, isAsync: boolean, tName: string): string {
  if (format === "next-intl") {
    const call = isAsync ? "await getTranslations()" : "useTranslations()";
    return `const ${tName} = ${call};`;
  }
  return tName === "t"
    ? `const { t } = useTranslation();`
    : `const { t: ${tName} } = useTranslation();`;
}

function importSpecFor(format: HookFormat, isAsync: boolean): ImportSpec {
  if (format === "next-intl") {
    return isAsync
      ? { module: "next-intl/server", name: "getTranslations" }
      : { module: "next-intl", name: "useTranslations" };
  }
  return { module: "react-i18next", name: "useTranslation" };
}

/**
 * Plan a hook insertion for every component that contains a wrapped site.
 * Scope-aware: inserts into EACH component (not just the first); uses
 * getTranslations for async server components; and when the component subtree
 * already binds `t` (e.g. a `map((t) => …)` param), uses an alternate
 * identifier so the hook can never be shadowed. Components whose body is an
 * expression (no block) or that already have a hook are handled without
 * producing a redeclaration.
 */
export function planHooks(
  source: string,
  componentStarts: string[],
  format: HookFormat,
): HookPlan {
  const ast = parseSource(source);
  const starts = new Set(componentStarts.map((s) => Number(s)));
  const pathByStart = new Map<number, any>();

  traverse(ast, {
    "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression"(path: any) {
      if (starts.has(path.node.start)) pathByStart.set(path.node.start, path);
    },
  });

  const insertions: HookInsertion[] = [];
  const importSpecs: ImportSpec[] = [];
  const tNameByComponent = new Map<string, string>();
  const skippedComponents = new Map<string, string>();
  const seenImport = new Set<string>();

  const addImport = (spec: ImportSpec) => {
    const k = `${spec.module}:${spec.name}`;
    if (!seenImport.has(k)) {
      seenImport.add(k);
      importSpecs.push(spec);
    }
  };

  for (const start of starts) {
    const key = String(start);
    const path = pathByStart.get(start);
    if (!path) {
      skippedComponents.set(key, "component function not found");
      continue;
    }
    const fn = path.node;
    const isAsync = !!fn.async;
    const bodyIsBlock = fn.body?.type === "BlockStatement";
    const bodyText = bodyIsBlock ? source.slice(fn.body.start, fn.body.end) : "";
    const hasHook = /\b(useTranslations|useTranslation|getTranslations)\s*\(/.test(bodyText);
    const bindsT = subtreeBindsIdentifier(path, "t");

    if (hasHook && bindsT) {
      tNameByComponent.set(key, "t"); // already wired; reuse
      continue;
    }
    if (!bodyIsBlock) {
      skippedComponents.set(key, "component body is an expression, not a block");
      continue;
    }
    if (format === "i18next" && isAsync) {
      skippedComponents.set(key, "async component not supported for i18next");
      continue;
    }

    const tName = bindsT ? "tTransia" : "t";
    tNameByComponent.set(key, tName);

    const braceStart = fn.body.start;
    const nlAfter = source.indexOf("\n", braceStart);
    const pos = nlAfter !== -1 ? nlAfter + 1 : braceStart + 1;
    insertions.push({ pos, text: `  ${hookText(format, isAsync, tName)}\n` });
    addImport(importSpecFor(format, isAsync));
  }

  return { insertions, importSpecs, tNameByComponent, skippedComponents };
}

/**
 * Lay out import statements for the needed specs, inserted AFTER any directive
 * prologue ("use client"/"use server") and after existing imports. Specs
 * already imported are skipped; returns [] if nothing to add.
 */
export function planImports(source: string, specs: ImportSpec[]): HookInsertion[] {
  if (specs.length === 0) return [];
  const ast = parseSource(source);

  let insertAfter = 0;
  const existing = new Set<string>();

  for (const d of (ast.program as any).directives ?? []) {
    insertAfter = Math.max(insertAfter, d.end);
  }
  for (const node of ast.program.body) {
    if (node.type === "ImportDeclaration") {
      insertAfter = Math.max(insertAfter, node.end);
      const mod = (node as any).source.value;
      for (const spec of (node as any).specifiers) {
        if (spec.type === "ImportSpecifier" && spec.imported?.name) {
          existing.add(`${mod}:${spec.imported.name}`);
        }
      }
    }
  }

  const byModule = new Map<string, string[]>();
  for (const s of specs) {
    if (existing.has(`${s.module}:${s.name}`)) continue;
    const arr = byModule.get(s.module) ?? [];
    if (!arr.includes(s.name)) arr.push(s.name);
    byModule.set(s.module, arr);
  }
  if (byModule.size === 0) return [];

  const lines: string[] = [];
  for (const [mod, names] of byModule) {
    lines.push(`import { ${names.join(", ")} } from "${mod}";`);
  }

  let pos: number;
  if (insertAfter > 0) {
    const nl = source.indexOf("\n", insertAfter);
    pos = nl !== -1 ? nl + 1 : insertAfter;
  } else {
    pos = 0;
  }

  return [{ pos, text: `${lines.join("\n")}\n` }];
}
