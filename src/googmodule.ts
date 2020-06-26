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
 * TypeScript defaults all exported values to `void 0` by adding a statement at
 * the top of the file that looks like:
 *
 * ```
 * exports.a = exports.b = exports.c = void 0;
 * ```
 *
 * This matches that code snippet.
 */
function checkExportsVoid0Assignment(expr: ts.Expression): boolean {
  // Verify this looks something like `exports.abc = exports.xyz = void 0;`.
  if (!ts.isBinaryExpression(expr)) return false;
  if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;

  // Verify the left side of the expression is an access on `exports`.
  if (!ts.isPropertyAccessExpression(expr.left)) return false;
  if (!ts.isIdentifier(expr.left.expression)) return false;
  if (expr.left.expression.escapedText !== 'exports') return false;

  // If the right side is another `exports.abc = ...` check that to see if we
  // eventually hit a `void 0`.
  if (ts.isBinaryExpression(expr.right)) {
    return checkExportsVoid0Assignment(expr.right);
  }

  // Verify the right side is exactly "void 0";
  if (!ts.isVoidExpression(expr.right)) return false;
  if (!ts.isNumericLiteral(expr.right.expression)) return false;
  if (expr.right.expression.text !== '0') return false;
  return true;
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
      return ([] as ts.Statement[]).concat(...expr.elements.map(visit));
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
      if ((sf as any)['kind'] !== ts.SyntaxKind.SourceFile) return sf;

      // JS scripts (as opposed to modules), must not be rewritten to
      // goog.modules.
      if (host.isJsTranspilation && !isModule(sf)) {
        return sf;
      }

      // TypeScript will create at most one `exports.abc = exports.def = void 0`
      // per file. We keep track of if we have already seen it here. If we have
      // seen it already that probably means there was some code like `export
      // const abc = void 0` that we don't want to erase.
      let didRewriteDefaultExportsAssignment = false;

      let moduleVarCounter = 1;
      /**
       * Creates a new unique variable name for holding an imported module. This
       * is used to split places where TS wants to codegen code like:
       *   someExpression(require(...));
       * which we then rewrite into
       *   var x = require(...); someExpression(x);
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
       * maybeCreateGoogRequire returns a `goog.require()` call for the given
       * CommonJS `require` call. Returns null if `call` is not a CommonJS
       * require.
       *
       * @param newIdent The identifier to assign the result of the goog.require
       *     to, or undefined if no assignment is needed.
       */
      function maybeCreateGoogRequire(
          original: ts.Statement, call: ts.CallExpression,
          newIdent: ts.Identifier|undefined): ts.Statement|null {
        const importedUrl = extractRequire(call);
        if (!importedUrl) return null;
        const imp = importPathToGoogNamespace(host, sf, importedUrl);
        modulesManifest.addReferencedModule(sf.fileName, imp.text);
        const existingImport: ts.Identifier|undefined =
            namespaceToModuleVarName.get(imp.text);
        let initializer: ts.Expression;
        if (!existingImport) {
          if (newIdent) namespaceToModuleVarName.set(imp.text, newIdent);
          initializer = createGoogCall('require', imp);
        } else {
          initializer = existingImport;
        }

        // In JS modules it's recommended that users get a handle on the
        // goog namespace via:
        //
        //    import * as goog from 'google3/javascript/closure/goog.js';
        //
        // In a goog.module we just want to access the global `goog` value,
        // so we skip emitting that import as a goog.require.
        // We check the goog module name so that we also catch relative imports.
        if (newIdent && newIdent.escapedText === 'goog' &&
            imp.text === 'google3.javascript.closure.goog') {
          return createNotEmittedStatementWithComments(sf, original);
        }

        if (newIdent) {
          // Create a statement like one of:
          //   var foo = goog.require('bar');
          //   var foo = existingImport;
          const varDecl = ts.createVariableDeclaration(
              newIdent, /* type */ undefined, initializer);
          const newStmt = ts.createVariableStatement(
              /* modifiers */ undefined,
              ts.createVariableDeclarationList(
                  [varDecl],
                  // Use 'const' in ES6 mode so Closure properly forwards type
                  // aliases.
                  host.es5Mode ? undefined : ts.NodeFlags.Const));
          return ts.setOriginalNode(
              ts.setTextRange(newStmt, original), original);
        } else if (!newIdent && !existingImport) {
          // Create a statement like:
          //   goog.require('bar');
          const newStmt = ts.createExpressionStatement(initializer);
          return ts.setOriginalNode(
              ts.setTextRange(newStmt, original), original);
        }
        return createNotEmittedStatementWithComments(sf, original);
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
       * Rewrites code generated by `export * as ns from 'ns'` to something like:
       *
       * ```
       * const tsickle_module_n_ = goog.require('ns');
       * exports.ns = tsickle_module_n_;
       * ```
       *
       * Separating the `goog.require` and `exports.ns` assignment is required by Closure to
       * correctly infer the type of the exported namespace.
       */
      function maybeRewriteExportStarAsNs(stmt: ts.Statement): ts.Statement[]|null {
        // Ensure this looks something like `exports.ns = require('ns);`.
        if (!ts.isExpressionStatement(stmt)) return null;
        if (!ts.isBinaryExpression(stmt.expression)) return null;
        if (stmt.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;

        // Ensure the left side of the expression is an access on `exports`.
        if (!ts.isPropertyAccessExpression(stmt.expression.left)) return null;
        if (!ts.isIdentifier(stmt.expression.left.expression)) return null;
        if (stmt.expression.left.expression.escapedText !== 'exports') return null;

        // Grab the call to `require`, and exit early if not calling `require`.
        if (!ts.isCallExpression(stmt.expression.right)) return null;
        const ident = ts.createIdentifier(nextModuleVar());
        const require = maybeCreateGoogRequire(stmt, stmt.expression.right, ident);
        if (!require) return null;

        const exportedName = stmt.expression.left.name;
        const exportStmt = ts.setOriginalNode(
            ts.setTextRange(
                ts.createExpressionStatement(ts.createAssignment(
                    ts.createPropertyAccess(ts.createIdentifier('exports'), exportedName), ident)),
                stmt),
            stmt);

        return [require, exportStmt];
      }

      /**
       * When re-exporting an export from another module TypeScript will wrap it
       * with an `Object.defineProperty` and getter function to emulate a live
       * binding, per the ESM spec. goog.module doesn't allow for mutable
       * exports and Closure Compiler doesn't allow `Object.defineProperty` to
       * be used with `exports`, so we rewrite the live binding to look like a
       * plain `exports` assignment. For example, this statement:
       *
       * ```
       * Object.defineProperty(exports, "a", {
       *   enumerable: true, get: function () { return a_1.a; }
       * });
       * ```
       *
       * will be transformed into:
       *
       * ```
       * exports.a = a_1.a;
       * ```
       */
      function rewriteObjectDefinePropertyOnExports(
          stmt: ts.ExpressionStatement): ts.Statement|null {
        // Verify this node is a function call.
        if (!ts.isCallExpression(stmt.expression)) return null;

        // Verify the node being called looks like `a.b`.
        const callExpr = stmt.expression;
        if (!ts.isPropertyAccessExpression(callExpr.expression)) return null;

        // Verify that the `a.b`-ish thing is actully `Object.defineProperty`.
        const propAccess = callExpr.expression;
        if (!ts.isIdentifier(propAccess.expression)) return null;
        if (propAccess.expression.text !== 'Object') return null;
        if (propAccess.name.text !== 'defineProperty') return null;

        // Grab each argument to `Object.defineProperty`, and verify that there
        // are exactly three arguments. The first argument should be the global
        // `exports` object, the second is the exported name as a string
        // literal, and the third is a configuration object.
        if (callExpr.arguments.length !== 3) return null;
        const [objDefArg1, objDefArg2, objDefArg3] = callExpr.arguments;
        if (!ts.isIdentifier(objDefArg1)) return null;
        if (objDefArg1.text !== 'exports') return null;
        if (!ts.isStringLiteral(objDefArg2)) return null;
        if (!ts.isObjectLiteralExpression(objDefArg3)) return null;

        // Returns a "finder" function to location an object property.
        function findPropNamed(name: string) {
          return (p: ts.ObjectLiteralElementLike) => {
            return ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) &&
                p.name.text === name;
          };
        }

        // Verify that the export is marked as enumerable. If it isn't then this
        // was not generated by TypeScript.
        const enumerableConfig =
            objDefArg3.properties.find(findPropNamed('enumerable'));
        if (!enumerableConfig) return null;
        if (!ts.isPropertyAssignment(enumerableConfig)) return null;
        if (enumerableConfig.initializer.kind !== ts.SyntaxKind.TrueKeyword) {
          return null;
        }

        // Verify that the export has a getter function.
        const getConfig = objDefArg3.properties.find(findPropNamed('get'));
        if (!getConfig) return null;
        if (!ts.isPropertyAssignment(getConfig)) return null;
        if (!ts.isFunctionExpression(getConfig.initializer)) return null;

        // Verify that the getter function has exactly one statement that is a
        // return statement. The node being returned is the real exported value.
        const getterFunc = getConfig.initializer;
        if (getterFunc.body.statements.length !== 1) return null;
        const getterReturn = getterFunc.body.statements[0];
        if (!ts.isReturnStatement(getterReturn)) return null;
        const realExportValue = getterReturn.expression;
        if (!realExportValue) return null;

        // Create a new export statement using the exported name found as the
        // second argument to `Object.defineProperty` with the value of the
        // node returned by the getter function.
        const exportStmt = ts.setOriginalNode(
            ts.setTextRange(
                ts.createExpressionStatement(ts.createAssignment(
                    ts.createPropertyAccess(
                        ts.createIdentifier('exports'), objDefArg2.text),
                    realExportValue)),
                stmt),
            stmt);

        return exportStmt;
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

            // If we have not already seen the defaulted export assignment 
            // initializing all exports to `void 0`, skip the statement and mark
            // that we have have now seen it.
            if (!didRewriteDefaultExportsAssignment &&
              checkExportsVoid0Assignment(exprStmt.expression)) {
              didRewriteDefaultExportsAssignment = true;
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
            //   exports.ns = require('...');
            // which is generated by the `export * as ns from` syntax.
            const exportStarAsNs = maybeRewriteExportStarAsNs(exprStmt);
            if (exportStarAsNs) {
              stmts.push(...exportStarAsNs);
              return;
            }

            // Checks for:
            //   Object.defineProperty(exports, 'a', {
            //     enumerable: true, get: { return ...; }
            //   })
            // which is a live binding generated when re-exporting from another
            // module.
            const exportFromObjDefProp =
                rewriteObjectDefinePropertyOnExports(exprStmt);
            if (exportFromObjDefProp) {
              stmts.push(exportFromObjDefProp);
              return;
            }

            // The rest of this block handles only some function call forms:
            //   goog.declareModuleId(...);
            //   require('foo');
            //   __exportStar(require('foo'), ...);
            const expr = exprStmt.expression;
            if (!ts.isCallExpression(expr)) break;
            let callExpr = expr;

            // Check for declareModuleId.
            const declaredModuleId = maybeRewriteDeclareModuleId(exprStmt, callExpr);
            if (declaredModuleId) {
              statements.push(declaredModuleId);
              return;
            }

            // Check for __exportStar, the commonjs version of 'export *'.
            // export * creates either a pure top-level '__export(require(...))'
            // or the imported version, 'tslib.__exportStar(require(...))'. The
            // imported version is only substituted later on though, so appears
            // as a plain "__exportStar" on the top level here.
            const isExportStar = ts.isIdentifier(expr.expression) &&
                (expr.expression.text === '__exportStar' ||
                 expr.expression.text === '__export');
            let newIdent: ts.Identifier|undefined;
            if (isExportStar) {
              // Extract the goog.require() from the call. (It will be verified
              // as a goog.require() below.)
              callExpr = expr.arguments[0] as ts.CallExpression;
              newIdent = ts.createIdentifier(nextModuleVar());
            }

            // Check whether the call is actually a require() and translate
            // as appropriate.
            const require =
                maybeCreateGoogRequire(exprStmt, callExpr, newIdent);
            if (!require) break;
            statements.push(require);

            // If this was an export star, split it up into the import (created
            // by the maybe call above), and the export operation. This avoids a
            // Closure complaint about non-top-level requires.
            if (isExportStar) {
              const args: ts.Expression[] = [newIdent!];
              if (expr.arguments.length > 1) args.push(expr.arguments[1]);
              statements.push(ts.createStatement(
                  ts.createCall(expr.expression, undefined, args)));
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

      // Add `goog.require('tslib');` if not JS transpilation, and it hasn't already been required.
      // Rationale:
      // TS gets compiled to Development mode (ES5) and Closure mode (~ES6)
      // sources. Tooling generates module manifests from the Closure version.
      // These manifests are used both with the Closure version and the
      // Development mode version. 'tslib' is sometimes required by the
      // development version but not the Closure version. Inserting the import
      // below unconditionally makes sure that the module manifests are
      // identical between Closure and Development mode, avoiding breakages
      // caused by missing module dependencies.
      if (!host.isJsTranspilation) {
        // Get a copy of the already resolved module names before calling
        // resolveModuleName on 'tslib'. Otherwise, resolveModuleName will
        // add 'tslib' to namespaceToModuleVarName and prevent checking whether
        // 'tslib' has already been required.
        const resolvedModuleNames = [...namespaceToModuleVarName.keys()];

        const tslibModuleName =
            host.pathToModuleName(sf.fileName, resolveModuleName(host, sf.fileName, 'tslib'));

        // Only add the extra require if it hasn't already been required
        if (resolvedModuleNames.indexOf(tslibModuleName) === -1) {
          const tslibImport = ts.createExpressionStatement(
              createGoogCall('require', createSingleQuoteStringLiteral(tslibModuleName)));

          // Place the goog.require('tslib') statement right after the goog.module statements
          headerStmts.push(tslibImport);
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
