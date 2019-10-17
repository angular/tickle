/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import * as ts from 'typescript';

import {ModulesManifest} from './modules_manifest';
import * as path from './path';
import {createNotEmittedStatementWithComments, createSingleQuoteStringLiteral,} from './transformer_util';

export interface GoogModuleProcessorHost {
  /**
   * Takes a context (ts.SourceFile.fileName of the current file) and the import URL of an ES6
   * import and generates a googmodule module name for the imported module.
   */
  pathToModuleName(context: string, importPath: string): string;
  /**
   * If we do googmodule processing, we polyfill module.id, since that's
   * part of ES6 modules.  This function determines what the module.id will be
   * for each file.
   */
  fileNameToModuleId(fileName: string): string;
  /** Identifies whether this file is the result of a JS transpilation. */
  isJsTranspilation?: boolean;
  /** Whether the emit targets ES5 or ES6+. */
  es5Mode?: boolean;
  /** expand "import 'foo';" to "import 'foo/index';" if it points to an index file. */
  convertIndexImportShorthand?: boolean;

  options: ts.CompilerOptions;
  moduleResolutionHost: ts.ModuleResolutionHost;
}

/**
 * Returns true if node is a property access of `child` on the identifier `parent`.
 */
function isPropertyAccess(node: ts.Node, parent: string, child: string): boolean {
  if (!ts.isPropertyAccessExpression(node)) return false;
  return ts.isIdentifier(node.expression) && node.expression.escapedText === parent &&
      node.name.escapedText === child;
}

/** Returns true if expr is "module.exports = ...;". */
function isModuleExportsAssignment(expr: ts.ExpressionStatement): boolean {
  if (!ts.isBinaryExpression(expr.expression)) return false;
  if (expr.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  return isPropertyAccess(expr.expression.left, 'module', 'exports');
}

/** Returns true if expr is "exports = ...;". */
function isExportsAssignment(expr: ts.ExpressionStatement): boolean {
  if (!ts.isBinaryExpression(expr.expression)) return false;
  if (expr.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  return ts.isIdentifier(expr.expression.left) && expr.expression.left.text === 'exports';
}

/** isUseStrict returns true if node is a "use strict"; statement. */
function isUseStrict(node: ts.Node): boolean {
  if (node.kind !== ts.SyntaxKind.ExpressionStatement) return false;
  const exprStmt = node as ts.ExpressionStatement;
  const expr = exprStmt.expression;
  if (expr.kind !== ts.SyntaxKind.StringLiteral) return false;
  const literal = expr as ts.StringLiteral;
  return literal.text === 'use strict';
}

/**
 * TypeScript inserts the following code to mark ES moduels in CommonJS:
 *   Object.defineProperty(exports, "__esModule", { value: true });
 * This matches that code snippet.
 */
function isEsModuleProperty(stmt: ts.ExpressionStatement): boolean {
  // We're matching the explicit source text generated by the TS compiler.
  // Object.defineProperty(exports, "__esModule", { value: true });
  const expr = stmt.expression;
  if (!ts.isCallExpression(expr)) return false;
  if (!isPropertyAccess(expr.expression, 'Object', 'defineProperty')) return false;
  if (expr.arguments.length !== 3) return false;
  const [exp, esM, val] = expr.arguments;
  if (!ts.isIdentifier(exp) || exp.escapedText !== 'exports') return false;
  if (!ts.isStringLiteral(esM) || esM.text !== '__esModule') return false;
  if (!ts.isObjectLiteralExpression(val) || val.properties.length !== 1) return false;
  const prop = val.properties[0];
  if (!ts.isPropertyAssignment(prop)) return false;
  const ident = prop.name;
  if (!ident || !ts.isIdentifier(ident) || ident.text !== 'value') return false;
  return prop.initializer.kind === ts.SyntaxKind.TrueKeyword;
}

/**
 * Returns the string argument if call is of the form
 *   require('foo')
 */
function extractRequire(call: ts.CallExpression): string|null {
  // Verify that the call is a call to require(...).
  if (call.expression.kind !== ts.SyntaxKind.Identifier) return null;
  const ident = call.expression as ts.Identifier;
  if (ident.escapedText !== 'require') return null;

  // Verify the call takes a single string argument and grab it.
  if (call.arguments.length !== 1) return null;
  const arg = call.arguments[0];
  if (arg.kind !== ts.SyntaxKind.StringLiteral) return null;
  return (arg as ts.StringLiteral).text;
}

/** Creates a call expression corresponding to `goog.${methodName}(${literal})`. */
function createGoogCall(methodName: string, literal: ts.StringLiteral): ts.CallExpression {
  return ts.createCall(
      ts.createPropertyAccess(ts.createIdentifier('goog'), methodName), undefined, [literal]);
}

/**
 * Extracts the namespace part of a goog: import URL, or returns null if the given import URL is not
 * a goog: import.
 *
 * For example, for `import 'goog:foo.Bar';`, returns `foo.Bar`.
 */
export function extractGoogNamespaceImport(tsImport: string): string|null {
  if (tsImport.match(/^goog:/)) return tsImport.substring('goog:'.length);
  return null;
}

/**
 * Convert from implicit `import {} from 'pkg'` to a full resolved file name, including any `/index`
 * suffix and also resolving path mappings. TypeScript and many module loaders support the
 * shorthand, but `goog.module` does not, so tsickle needs to resolve the module name shorthand
 * before generating `goog.module` names.
 */
export function resolveModuleName(
    {options, moduleResolutionHost}:
        {options: ts.CompilerOptions, moduleResolutionHost: ts.ModuleResolutionHost},
    pathOfImportingFile: string, imported: string): string {
  // The strategy taken here is to use ts.resolveModuleName() to resolve the import to
  // a specific path, which resolves any /index and path mappings.
  const resolved =
      ts.resolveModuleName(imported, pathOfImportingFile, options, moduleResolutionHost);
  if (!resolved || !resolved.resolvedModule) return imported;
  const resolvedModule = resolved.resolvedModule.resolvedFileName;

  // Check if the resolution went into node_modules.
  // Note that the ResolvedModule returned by resolveModuleName() has an
  // attribute isExternalLibraryImport that is documented with
  // "True if resolvedFileName comes from node_modules", but actually it is just
  // true if the absolute path includes node_modules, and is always true when
  // tsickle itself is under a directory named node_modules.
  const relativeResolved = path.relative(options.rootDir || '', resolvedModule);
  if (relativeResolved.indexOf('node_modules') !== -1) {
    // Imports into node_modules resolve through package.json and must be
    // specially handled by the loader anyway.  Return the input.
    return imported;
  }

  // Otherwise return the full resolved file name. This path will be turned into a module name using
  // AnnotatorHost#pathToModuleName, which also takes care of baseUrl and rootDirs.
  return resolved.resolvedModule.resolvedFileName;
}

/**
 * importPathToGoogNamespace converts a TS/ES module './import/path' into a goog.module compatible
 * namespace, handling regular imports and `goog:` namespace imports.
 */
function importPathToGoogNamespace(
    host: GoogModuleProcessorHost, file: ts.SourceFile, tsImport: string): ts.StringLiteral {
  let modName: string;
  const nsImport = extractGoogNamespaceImport(tsImport);
  if (nsImport !== null) {
    // This is a namespace import, of the form "goog:foo.bar".
    // Fix it to just "foo.bar".
    modName = nsImport;
  } else {
    if (host.convertIndexImportShorthand) {
      tsImport = resolveModuleName(host, file.fileName, tsImport);
    }
    modName = host.pathToModuleName(file.fileName, tsImport);
  }
  return createSingleQuoteStringLiteral(modName);
}

/**
 * Replace "module.exports = ..." with just "exports = ...". Returns null if `expr` is not an
 * exports assignment.
 */
function rewriteModuleExportsAssignment(expr: ts.ExpressionStatement) {
  if (!ts.isBinaryExpression(expr.expression)) return null;
  if (expr.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  if (!isPropertyAccess(expr.expression.left, 'module', 'exports')) return null;
  return ts.setOriginalNode(
      ts.setTextRange(
          ts.createStatement(
              ts.createAssignment(ts.createIdentifier('exports'), expr.expression.right)),
          expr),
      expr);
}

/**
 * Convert a series of comma-separated expressions
 *   x = foo, y(), z.bar();
 * with statements
 *   x = foo; y(); z.bar();
 * This is for handling in particular the case where
 *   exports.x = ..., exports.y = ...;
 * which Closure rejects.
 *
 * @return An array of statements if it converted, or null otherwise.
 */
function rewriteCommaExpressions(expr: ts.Expression): ts.Statement[]|null {
  // There are two representation for comma expressions:
  // 1) a tree of "binary expressions" whose contents are comma operators
  const isBinaryCommaExpression = (expr: ts.Expression): expr is ts.BinaryExpression =>
      ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.CommaToken;
  // or,
  // 2) a "comma list" expression, where the subexpressions are in one array
  const isCommaList = (expr: ts.Expression): expr is ts.CommaListExpression =>
      expr.kind === ts.SyntaxKind.CommaListExpression;

  if (!isBinaryCommaExpression(expr) && !isCommaList(expr)) {
    return null;
  }

  // Recursively visit comma-separated subexpressions, and collect them all as
  // separate expression statements.
  return visit(expr);

  function visit(expr: ts.Expression): ts.Statement[] {
    if (isBinaryCommaExpression(expr)) {
      return visit(expr.left).concat(visit(expr.right));
    }
    if (isCommaList(expr)) {
      // TODO(blickly): Simplify using flatMap once node 11 available
      return expr.elements.reduce((acc: ts.Statement[], x) => acc.concat(visit(x)), []);
    }
    return [ts.setOriginalNode(ts.createExpressionStatement(expr), expr)];
  }
}

/**
 * commonJsToGoogmoduleTransformer returns a transformer factory that converts TypeScript's CommonJS
 * module emit to Closure Compiler compatible goog.module and goog.require statements.
 */
export function commonJsToGoogmoduleTransformer(
    host: GoogModuleProcessorHost, modulesManifest: ModulesManifest, typeChecker: ts.TypeChecker,
    diagnostics: ts.Diagnostic[]): (context: ts.TransformationContext) =>
    ts.Transformer<ts.SourceFile> {
  return (context: ts.TransformationContext): ts.Transformer<ts.SourceFile> => {
    // TS' CommonJS processing uses onSubstituteNode to, at the very end of processing, substitute
    // "modulename.default" for default imports. We intercept the substitution here, check if it's a
    // .default access, then check if the original node (and thus original import) was from a goog:
    // module, and if so, replace with just the module name.
    const previousOnSubstituteNode = context.onSubstituteNode;
    context.enableSubstitution(ts.SyntaxKind.PropertyAccessExpression);
    context.onSubstituteNode = (hint, node: ts.Node): ts.Node => {
      node = previousOnSubstituteNode(hint, node);
      if (!ts.isPropertyAccessExpression(node)) return node;
      if (node.name.text !== 'default') return node;
      if (!ts.isIdentifier(node.expression)) return node;
      // Find the import declaration this node comes from.
      // This may be the original node, if the identifier was transformed from it.
      const orig = ts.getOriginalNode(node.expression);
      let importExportDecl: ts.ImportDeclaration|ts.ExportDeclaration;
      if (ts.isImportDeclaration(orig) || ts.isExportDeclaration(orig)) {
        importExportDecl = orig;
      } else {
        // Alternatively, we can try to find the declaration of the symbol. This only works for
        // user-written .default accesses, the generated ones do not have a symbol associated as
        // they are only produced in the CommonJS transformation, after type checking.
        const sym = typeChecker.getSymbolAtLocation(node.expression);
        if (!sym) return node;
        const decls = sym.getDeclarations();
        if (!decls || !decls.length) return node;
        const decl = decls[0];
        if (decl.parent && decl.parent.parent && ts.isImportDeclaration(decl.parent.parent)) {
          importExportDecl = decl.parent.parent;
        } else {
          return node;
        }
      }
      // If the import declaration's URL is a "goog:..." style namespace, then all ".default"
      // accesses on it should be replaced with the symbol itself.
      // This allows referring to the module-level export of a "goog.module" or "goog.provide" as if
      // it was an ES6 default export.
      if (extractGoogNamespaceImport((importExportDecl.moduleSpecifier as ts.StringLiteral).text)) {
        // Substitute "foo.default" with just "foo".
        return node.expression;
      }
      return node;
    };

    return (sf: ts.SourceFile): ts.SourceFile => {
      // In TS2.9, transformers can receive Bundle objects, which this code cannot handle (given
      // that a bundle by definition cannot be a goog.module()). The cast through any is necessary
      // to remain compatible with earlier TS versions.
      // tslint:disable-next-line:no-any
      if ((sf as any).kind !== ts.SyntaxKind.SourceFile) return sf;

      // JS scripts (as opposed to modules), must not be rewritten to
      // goog.modules.
      if (host.isJsTranspilation && !isModule(sf)) {
        return sf;
      }

      let moduleVarCounter = 1;
      /**
       * Creates a new unique variable to assign side effect imports into. This allows us to re-use
       * the variable later on for other imports of the same namespace.
       */
      function nextModuleVar() {
        return `tsickle_module_${moduleVarCounter++}_`;
      }

      /**
       * Maps goog.require namespaces to the variable name they are assigned into. E.g.:
       *     var $varName = goog.require('$namespace'));
       */
      const namespaceToModuleVarName = new Map<string, ts.Identifier>();

      /**
       * maybeCreateGoogRequire returns a `goog.require()` call for the given CommonJS `require`
       * call. Returns null if `call` is not a CommonJS require.
       */
      function maybeCreateGoogRequire(
          original: ts.Statement, call: ts.CallExpression, newIdent: ts.Identifier): ts.Statement|
          null {
        const importedUrl = extractRequire(call);
        if (!importedUrl) return null;
        const imp = importPathToGoogNamespace(host, sf, importedUrl);
        modulesManifest.addReferencedModule(sf.fileName, imp.text);
        const ident: ts.Identifier|undefined = namespaceToModuleVarName.get(imp.text);
        let initializer: ts.Expression;
        if (!ident) {
          namespaceToModuleVarName.set(imp.text, newIdent);
          initializer = createGoogCall('require', imp);
        } else {
          initializer = ident;
        }

        // In JS modules it's recommended that users get a handle on the
        // goog namespace via:
        //
        //    import * as goog from 'google3/javascript/closure/goog.js';
        //
        // In a goog.module we just want to access the global `goog` value,
        // so we skip emitting that import as a goog.require.
        // We check the goog module name so that we also catch relative imports.
        if (newIdent.escapedText === 'goog' && imp.text === 'google3.javascript.closure.goog') {
          return createNotEmittedStatementWithComments(sf, original);
        }

        const varDecl = ts.createVariableDeclaration(newIdent, /* type */ undefined, initializer);
        const newStmt = ts.createVariableStatement(
            /* modifiers */ undefined,
            ts.createVariableDeclarationList(
                [varDecl],
                // Use 'const' in ES6 mode so Closure properly forwards type aliases.
                host.es5Mode ? undefined : ts.NodeFlags.Const));
        return ts.setOriginalNode(ts.setTextRange(newStmt, original), original);
      }

      /**
       * Rewrite goog.declareModuleId to something that works in a goog.module.
       *
       * goog.declareModuleId exposes a JS module as a goog.module. After we
       * convert the JS module to a goog.module, what we really want is to
       * expose the current goog.module at two different module ids. This isn't
       * possible with the public APIs, but we can make it work at runtime
       * by writing a record to goog.loadedModules_.
       *
       * This only works at runtime, and would fail if compiled by closure
       * compiler, but that's ok because we only transpile JS in development
       * mode.
       */
      function maybeRewriteDeclareModuleId(
          original: ts.Statement, call: ts.CallExpression): ts.Statement|null {
        // Verify that the call is a call to goog.declareModuleId(...).
        if (!ts.isPropertyAccessExpression(call.expression)) {
          return null;
        }
        const propAccess = call.expression;
        if (propAccess.name.escapedText !== 'declareModuleId') {
          return null;
        }
        if (!ts.isIdentifier(propAccess.expression) ||
            propAccess.expression.escapedText !== 'goog') {
          return null;
        }

        // Verify the call takes a single string argument and grab it.
        if (call.arguments.length !== 1) {
          return null;
        }
        const arg = call.arguments[0];
        if (!ts.isStringLiteral(arg)) {
          return null;
        }
        const moduleId = arg.text;
        // replace goog.declareModuleId['foo.bar'] with:
        // goog.loadedModules_['foo.bar'] = {
        //   exports: exports,
        //   type: goog.ModuleType.GOOG,
        //   moduleId: 'foo.bar'
        // };
        //
        // For more info, see `goog.loadModule` in
        // https://github.com/google/closure-library/blob/master/closure/goog/base.js
        const newStmt = ts.createStatement(ts.createAssignment(
            ts.createElementAccess(
                ts.createPropertyAccess(
                    ts.createIdentifier('goog'), ts.createIdentifier('loadedModules_')),
                createSingleQuoteStringLiteral(moduleId)),
            ts.createObjectLiteral([
              ts.createPropertyAssignment('exports', ts.createIdentifier('exports')),
              ts.createPropertyAssignment(
                  'type',
                  ts.createPropertyAccess(
                      ts.createPropertyAccess(
                          ts.createIdentifier('goog'), ts.createIdentifier('ModuleType')),
                      ts.createIdentifier('GOOG'))),
              ts.createPropertyAssignment('moduleId', createSingleQuoteStringLiteral(moduleId)),
            ])));
        return ts.setOriginalNode(ts.setTextRange(newStmt, original), original);
      }

      /**
       * maybeRewriteRequireTslib rewrites a require('tslib') calls to goog.require('tslib'). It
       * returns the input statement untouched if it does not match.
       */
      function maybeRewriteRequireTslib(stmt: ts.Statement): ts.Statement|null {
        if (!ts.isExpressionStatement(stmt)) return null;
        if (!ts.isCallExpression(stmt.expression)) return null;
        const callExpr = stmt.expression;
        if (!ts.isIdentifier(callExpr.expression) || callExpr.expression.text !== 'require') {
          return null;
        }
        if (callExpr.arguments.length !== 1) return stmt;
        const arg = callExpr.arguments[0];
        if (!ts.isStringLiteral(arg) || arg.text !== 'tslib') return null;
        return ts.setOriginalNode(
            ts.setTextRange(ts.createStatement(createGoogCall('require', arg)), stmt), stmt);
      }

      /**
       * visitTopLevelStatement implements the main CommonJS to goog.module conversion. It visits a
       * SourceFile level statement and adds a (possibly) transformed representation of it into
       * statements. It adds at least one node per statement to statements.
       *
       * visitTopLevelStatement:
       * - converts require() calls to goog.require() calls, with or w/o var assignment
       * - removes "use strict"; and "Object.defineProperty(__esModule)" statements
       * - converts module.exports assignments to just exports assignments
       * - splits __exportStar() calls into require and export (this needs two statements)
       * - makes sure to only import each namespace exactly once, and use variables later on
       */
      function visitTopLevelStatement(
          statements: ts.Statement[], sf: ts.SourceFile, node: ts.Statement): void {
        // Handle each particular case by adding node to statements, then return.
        // For unhandled cases, break to jump to the default handling below.

        // In JS transpilation mode, always rewrite `require('tslib')` to
        // goog.require('tslib'), ignoring normal module resolution.
        if (host.isJsTranspilation) {
          const rewrittenTsLib = maybeRewriteRequireTslib(node);
          if (rewrittenTsLib) {
            statements.push(rewrittenTsLib);
            return;
          }
        }

        switch (node.kind) {
          case ts.SyntaxKind.ExpressionStatement: {
            const exprStmt = node as ts.ExpressionStatement;
            // Check for "use strict" and certain Object.defineProperty and skip it if necessary.
            if (isUseStrict(exprStmt) || isEsModuleProperty(exprStmt)) {
              stmts.push(createNotEmittedStatementWithComments(sf, exprStmt));
              return;
            }
            // Check for:
            //   module.exports = ...;
            const modExports = rewriteModuleExportsAssignment(exprStmt);
            if (modExports) {
              stmts.push(modExports);
              return;
            }
            // Check for use of the comma operator.
            // This occurs in code like
            //   exports.a = ..., exports.b = ...;
            // which we want to change into multiple statements.
            const commaExpanded = rewriteCommaExpressions(exprStmt.expression);
            if (commaExpanded) {
              stmts.push(...commaExpanded);
              return;
            }
            // Check for:
            //   "require('foo');" (a require for its side effects)
            const expr = exprStmt.expression;
            if (!ts.isCallExpression(expr)) break;
            let callExpr = expr;
            const declaredModuleId = maybeRewriteDeclareModuleId(exprStmt, callExpr);
            if (declaredModuleId) {
              statements.push(declaredModuleId);
              return;
            }
            // Handle export * in ES5 mode (in ES6 mode, export * is dereferenced already).
            // export * creates either a pure top-level '__export(require(...))' or the imported
            // version, 'tslib.__exportStar(require(...))'. The imported version is only substituted
            // later on though, so appears as a plain "__exportStar" on the top level here.
            const isExportStar =
                (ts.isIdentifier(expr.expression) && expr.expression.text === '__exportStar') ||
                (ts.isIdentifier(expr.expression) && expr.expression.text === '__export');
            if (isExportStar) callExpr = expr.arguments[0] as ts.CallExpression;
            const ident = ts.createIdentifier(nextModuleVar());
            const require = maybeCreateGoogRequire(exprStmt, callExpr, ident);
            if (!require) break;
            statements.push(require);
            // If this is an export star, split it up into the import (created by the maybe call
            // above), and the export operation. This avoids a Closure complaint about non-top-level
            // requires.
            if (isExportStar) {
              const args: ts.Expression[] = [ident];
              if (expr.arguments.length > 1) args.push(expr.arguments[1]);
              statements.push(ts.createStatement(ts.createCall(expr.expression, undefined, args)));
            }
            return;
          }
          case ts.SyntaxKind.VariableStatement: {
            // It's possibly of the form "var x = require(...);".
            const varStmt = node as ts.VariableStatement;
            // Verify it's a single decl (and not "var x = ..., y = ...;").
            if (varStmt.declarationList.declarations.length !== 1) break;
            const decl = varStmt.declarationList.declarations[0];

            // Grab the variable name (avoiding things like destructuring binds).
            if (decl.name.kind !== ts.SyntaxKind.Identifier) break;
            if (!decl.initializer || !ts.isCallExpression(decl.initializer)) {
              break;
            }
            const require = maybeCreateGoogRequire(varStmt, decl.initializer, decl.name);
            if (!require) break;
            statements.push(require);
            return;
          }
          default:
            break;
        }
        statements.push(node);
      }

      const moduleName = host.pathToModuleName('', sf.fileName);
      // Register the namespace this file provides.
      modulesManifest.addModule(sf.fileName, moduleName);

      // Convert each top level statement to goog.module.
      const stmts: ts.Statement[] = [];
      for (const stmt of sf.statements) {
        visitTopLevelStatement(stmts, sf, stmt);
      }

      // Additional statements that will be prepended (goog.module call etc).
      const headerStmts: ts.Statement[] = [];

      // Emit: goog.module('moduleName');
      const googModule =
          ts.createStatement(createGoogCall('module', createSingleQuoteStringLiteral(moduleName)));
      headerStmts.push(googModule);

      // Allow code to use `module.id` to discover its module URL, e.g. to resolve a template URL
      // against. Uses 'var', as this code is inserted in ES6 and ES5 modes. The following pattern
      // ensures closure doesn't throw an error in advanced optimizations mode.
      // var module = module || {id: 'path/to/module.ts'};
      const moduleId = host.fileNameToModuleId(sf.fileName);
      const moduleVarInitializer = ts.createBinary(
          ts.createIdentifier('module'), ts.SyntaxKind.BarBarToken,
          ts.createObjectLiteral(
              [ts.createPropertyAssignment('id', createSingleQuoteStringLiteral(moduleId))]));
      const modAssign = ts.createVariableStatement(
          /* modifiers */ undefined, ts.createVariableDeclarationList([ts.createVariableDeclaration(
                                         'module', /* type */ undefined, moduleVarInitializer)]));
      headerStmts.push(modAssign);

      if (!host.es5Mode) {
        // The module=module assignment suppresses an unused variable warning which may trigger
        // depending on the project's compilation flags.
        headerStmts.push(ts.createStatement(
            ts.createAssignment(ts.createIdentifier('module'), ts.createIdentifier('module'))));

        // The `exports = {}` serves as a default export to disable Closure Compiler's error
        // checking
        // for mutable exports. That's OK because TS compiler makes sure that consuming code always
        // accesses exports through the module object, so mutable exports work.
        // It is only inserted in ES6 because we strip `.default` accesses in ES5 mode, which breaks
        // when assigning an `exports = {}` object and then later accessing it.
        // However Closure bails if code later on assigns into exports directly, as we do if we have
        // an "exports = " block, so skip emit if that's the case.
        if (!sf.statements.find(
                s => ts.isExpressionStatement(s) &&
                    (isModuleExportsAssignment(s) || isExportsAssignment(s)))) {
          headerStmts.push(ts.createStatement(
              ts.createAssignment(ts.createIdentifier('exports'), ts.createObjectLiteral())));
        }
      }

      // Insert goog.module() etc after any leading comments in the source file. The comments have
      // been converted to NotEmittedStatements by transformer_util, which this depends on.
      const insertionIdx = stmts.findIndex(s => s.kind !== ts.SyntaxKind.NotEmittedStatement);
      if (insertionIdx === -1) {
        stmts.push(...headerStmts);
      } else {
        stmts.splice(insertionIdx, 0, ...headerStmts);
      }

      return ts.updateSourceFileNode(sf, ts.setTextRange(ts.createNodeArray(stmts), sf.statements));
    };
  };
}

function isModule(sourceFile: ts.SourceFile): boolean {
  interface InternalSourceFile extends ts.SourceFile {
    // An internal property that we use here to check whether a file is
    // syntactically a module or a script.
    externalModuleIndicator?: ts.Node;
  }
  return Boolean((sourceFile as InternalSourceFile).externalModuleIndicator);
}
