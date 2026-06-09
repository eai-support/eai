import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";

const ROUTE_FILE_NAME = "route.ts";

const ALLOWED_ROUTE_EXPORTS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
]);

export interface RouteExportViolation {
  readonly routeFile: string;
  readonly invalidExports: readonly string[];
}

async function walkRouteFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkRouteFiles(absolutePath)));
      continue;
    }

    if (entry.isFile() && entry.name === ROUTE_FILE_NAME) {
      files.push(absolutePath);
    }
  }

  return files;
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }

  return (
    ts.getModifiers(node)?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false
  );
}

function collectBindingNames(
  name: ts.BindingName,
  names: string[] = [],
): string[] {
  if (ts.isIdentifier(name)) {
    names.push(name.text);
    return names;
  }

  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        collectBindingNames(element.name, names);
      }
    }
  }

  return names;
}

function collectNamedExports(
  exportClause: ts.NamedExportBindings | undefined,
): string[] {
  if (!exportClause || !ts.isNamedExports(exportClause)) {
    return [];
  }

  return exportClause.elements.map((element) => element.name.text);
}

function collectInvalidExports(sourceFile: ts.SourceFile): string[] {
  const invalid: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      const exportName = statement.name?.text ?? "(anonymous)";
      if (!ALLOWED_ROUTE_EXPORTS.has(exportName)) {
        invalid.push(exportName);
      }
      continue;
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const exportName of collectBindingNames(declaration.name)) {
          if (!ALLOWED_ROUTE_EXPORTS.has(exportName)) {
            invalid.push(exportName);
          }
        }
      }
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      for (const exportName of collectNamedExports(statement.exportClause)) {
        if (!ALLOWED_ROUTE_EXPORTS.has(exportName)) {
          invalid.push(exportName);
        }
      }
      continue;
    }

    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      hasExportModifier(statement)
    ) {
      invalid.push(statement.name?.text ?? "(anonymous)");
      continue;
    }

    if (hasExportModifier(statement)) {
      invalid.push(
        statement.getText(sourceFile).split("\n", 1)[0]?.trim() ||
          "(unsupported export)",
      );
    }
  }

  return [...new Set(invalid)].sort((left, right) =>
    left.localeCompare(right),
  );
}

export async function scanAppRouterRouteExports(
  projectRoot: string,
): Promise<readonly RouteExportViolation[]> {
  const appRoot = join(projectRoot, "src", "app");
  try {
    const routeFiles = await walkRouteFiles(appRoot);
    const violations: RouteExportViolation[] = [];

    for (const routeFile of routeFiles) {
      const contents = await readFile(routeFile, "utf8");
      const sourceFile = ts.createSourceFile(
        routeFile,
        contents,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const invalidExports = collectInvalidExports(sourceFile);
      if (invalidExports.length > 0) {
        violations.push({
          routeFile: relative(projectRoot, routeFile).replace(/\\/g, "/"),
          invalidExports,
        });
      }
    }

    return violations.sort((left, right) =>
      left.routeFile.localeCompare(right.routeFile),
    );
  } catch {
    return [];
  }
}
