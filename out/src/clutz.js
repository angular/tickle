"use strict";
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeDeclarationTransformerFactory = void 0;
/**
 * @fileoverview Interactions with http://github.com/angular/clutz, which
 * is the inverse of Tsickle: Clutz converts Closure-annotated JS to d.ts files.
 *
 * It turns out when interacting with Clutz code, tsickle needs to be aware of
 * Clutz in a few ways.  The functionality in this module is only needed in apps
 * that use both Clutz and Tsickle together.
 */
const ts = require("typescript");
const googmodule = require("./googmodule");
const path = require("./path");
/**
 * Constructs a ts.CustomTransformerFactory that postprocesses the .d.ts
 * that are generated by ordinary TypeScript compilations to add some
 * Clutz-specific logic.  See generateClutzAliases.
 *
 * @param pathToModuleName Converts an absolute path to its dotted Closure name.
 */
function makeDeclarationTransformerFactory(typeChecker, pathToModuleName) {
    return (context) => {
        return {
            transformBundle() {
                // The TS API wants declaration transfomers to be able to handle Bundle,
                // but we don't support them within tsickle.
                throw new Error('did not expect to transform a bundle');
            },
            transformSourceFile(file) {
                const options = context.getCompilerOptions();
                // Construct
                //   import 'path/to/clutz_dts_file';
                // for Clutz imports.
                // Humans write Clutz imports like
                //   import 'goog:foo';
                // or
                //   import 'path/to/the/js_file';
                // so to for that import to resolve, you need to first import the clutz
                // d.ts that defines that declared module.
                const imports = gatherNecessaryClutzImports(typeChecker, file);
                let importStmts;
                if (imports.length > 0) {
                    importStmts = imports.map(fileName => {
                        fileName = path.relative(options.rootDir, fileName);
                        return ts.factory.createImportDeclaration(
                        /* decorators */ undefined, 
                        /* modifiers */ undefined, 
                        /* importClause */ undefined, 
                        /* moduleSpecifier */ ts.factory.createStringLiteral(fileName));
                    });
                }
                // Construct `declare global {}` in the Clutz namespace for symbols
                // Clutz might use.
                const globalBlock = generateClutzAliases(file, pathToModuleName(file.fileName), typeChecker, options);
                // Only need to transform file if we needed one of the above additions.
                if (!importStmts && !globalBlock)
                    return file;
                return ts.factory.updateSourceFile(file, [
                    ...(importStmts !== null && importStmts !== void 0 ? importStmts : []),
                    ...file.statements,
                    ...(globalBlock ? [globalBlock] : []),
                ]);
            }
        };
    };
}
exports.makeDeclarationTransformerFactory = makeDeclarationTransformerFactory;
/** Compares two strings and returns a number suitable for use in sort(). */
function stringCompare(a, b) {
    if (a < b)
        return -1;
    if (a > b)
        return 1;
    return 0;
}
/**
 * A tsickle produced declaration file might be consumed by Clutz
 * produced .d.ts files, which use symbol names based on Closure's internal
 * naming conventions, so we need to provide aliases for all the exported
 * symbols in the Clutz naming convention.
 */
function generateClutzAliases(sourceFile, moduleName, typeChecker, options) {
    var _a;
    const moduleSymbol = typeChecker.getSymbolAtLocation(sourceFile);
    const moduleExports = moduleSymbol && typeChecker.getExportsOfModule(moduleSymbol);
    if (!moduleExports)
        return undefined;
    // .d.ts files can be transformed, too, so we need to compare the original
    // node below.
    const origSourceFile = ts.getOriginalNode(sourceFile);
    // In order to write aliases, the exported symbols need to be available in the
    // the module scope. That is not always the case:
    //
    // export
    // 1) export const X;           // works
    //
    // reexport
    // 2) export {X} from './foo';  // doesn't
    //
    // imported reexport
    // 3) import {X} from './foo';  // works
    //    export {X} from './foo';
    //
    // getExportsOfModule returns all three types, but we need to separate 2).
    // For now we 'fix' 2) by simply not emitting a clutz alias, since clutz
    // interop is used in minority of scenarios.
    //
    // TODO(radokirov): attempt to add appropriate imports for 2) so that
    // currently finding out local appears even harder than fixing exports.
    const localExports = moduleExports.filter(e => {
        // If there are no declarations, be conservative and don't emit the aliases.
        // I don't know how can this happen, we have no tests that excercise it.
        if (!e.declarations)
            return false;
        // Skip default exports, they are not currently supported.
        // default is a keyword in typescript, so the name of the export being
        // default means that it's a default export.
        if (e.name === 'default')
            return false;
        // Use the declaration location to determine separate cases above.
        for (const d of e.declarations) {
            // This is a special case for export *. Technically, it is outside the
            // three cases outlined, but at this point we have rewritten it to a
            // reexport or an imported reexport. However, it appears that the
            // rewriting also has made it behave different from explicit named export
            // in the sense that the declaration appears to point at the original
            // location not the reexport location.  Since we can't figure out whether
            // there is a local import here, we err on the side of less emit.
            if (d.getSourceFile() !== origSourceFile) {
                return false;
            }
            // @internal marked APIs are not exported, so must not get aliases.
            // This uses an internal TS API, assuming that accessing this will be
            // more stable compared to implementing our own version.
            // tslint:disable-next-line:no-any
            const isInternalDeclaration = ts['isInternalDeclaration'];
            if (options.stripInternal && isInternalDeclaration(d, origSourceFile)) {
                return false;
            }
            if (!ts.isExportSpecifier(d)) {
                // we have a pure export (case 1) thus safe to emit clutz alias.
                return true;
            }
            // The declaration d is useless to separate reexport and import-reexport
            // because they both point to the reexporting file and not to the original
            // one.  However, there is another ts API that can do a deeper resolution.
            const localSymbol = typeChecker.getExportSpecifierLocalTargetSymbol(d);
            // I don't know how can this happen, but err on the side of less emit.
            if (!localSymbol)
                return false;
            // `declarations` is undefined for builtin symbols, such as `unknown`.
            if (!localSymbol.declarations)
                return false;
            // In case of no import we ended up in a declaration in foo.ts, while in
            // case of having an import localD is still in the reexporing file.
            for (const localD of localSymbol.declarations) {
                if (localD.getSourceFile() !== origSourceFile) {
                    return false;
                }
            }
        }
        return true;
    });
    if (!localExports.length)
        return undefined;
    // TypeScript 2.8 and TypeScript 2.9 differ on the order in which the
    // module symbols come out, so sort here to make the tests stable.
    localExports.sort((a, b) => stringCompare(a.name, b.name));
    const clutzModuleName = moduleName.replace(/\./g, '$');
    // Clutz might refer to the name in two different forms (stemming from
    // goog.provide and goog.module respectively).
    //
    // 1) global in clutz: ಠ_ಠ.clutz.module$contents$path$to$module_Symbol...
    // 2) local in a module: ಠ_ಠ.clutz.module$exports$path$to$module.Symbol...
    //
    // See examples at:
    // https://github.com/angular/clutz/tree/master/src/test/java/com/google/javascript/clutz
    // Case (1) from above.
    const globalExports = [];
    // Case (2) from above.
    const nestedExports = [];
    for (const symbol of localExports) {
        let localName = symbol.name;
        const declaration = (_a = symbol.declarations) === null || _a === void 0 ? void 0 : _a.find(d => d.getSourceFile() === origSourceFile);
        if (declaration && ts.isExportSpecifier(declaration) &&
            declaration.propertyName) {
            // If declared in an "export {X as Y};" export specifier, then X (stored
            // in propertyName) is the local name that resolves within the module,
            // whereas Y is only available on the exports, i.e. the name used to
            // address the symbol from outside the module. Use the localName for the
            // export then, but publish under the external name.
            localName = declaration.propertyName.text;
        }
        const mangledName = `module$contents$${clutzModuleName}_${symbol.name}`;
        // These ExportSpecifiers are the `foo as bar` bits as found in a larger
        // `export {foo as bar}` statement, which is constructed after this loop.
        globalExports.push(ts.factory.createExportSpecifier(
        /* isTypeOnly */ false, ts.factory.createIdentifier(localName), ts.factory.createIdentifier(mangledName)));
        nestedExports.push(ts.factory.createExportSpecifier(
        /* isTypeOnly */ false, localName === symbol.name ? undefined : localName, ts.factory.createIdentifier(symbol.name)));
    }
    // Create two export statements that will be used to contribute to the
    // ಠ_ಠ.clutz namespace.
    const globalDeclarations = [
        // 1) For globalExports,
        //      export {...};
        ts.factory.createExportDeclaration(
        /* decorators */ undefined, 
        /* modifiers */ undefined, 
        /* isTypeOnly */ false, ts.factory.createNamedExports(globalExports)),
        // 2) For nestedExports
        //      namespace module$exports$module$name$here {
        //        export {...};
        //      }
        ts.factory.createModuleDeclaration(
        /* decorators */ undefined, 
        /* modifiers */ [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)], ts.factory.createIdentifier(`module$exports$${clutzModuleName}`), ts.factory.createModuleBlock([
            ts.factory.createExportDeclaration(
            /* decorators */ undefined, 
            /* modifiers */ undefined, 
            /* isTypeOnly */ false, ts.factory.createNamedExports(nestedExports)),
        ]), ts.NodeFlags.Namespace),
    ];
    // Wrap a `declare global { namespace ಠ_ಠ.clutz { ... } }` around
    // the statements in globalDeclarations.
    return ts.factory.createModuleDeclaration(
    /* decorators */ undefined, 
    /* modifiers */ [ts.factory.createModifier(ts.SyntaxKind.DeclareKeyword)], ts.factory.createIdentifier('global'), ts.factory.createModuleBlock([
        ts.factory.createModuleDeclaration(
        /* decorators */ undefined, 
        /* modifiers */ undefined, 
        // Note: it's not exactly right to use a '.' within an identifier
        // like I am doing here, but I could not figure out how to construct
        // an AST that has a dotted name here -- the types require a
        // ModuleDeclaration, but nesting another ModuleDeclaration in here
        // always created a new {} block, despite trying the
        // 'NestedNamespace' flag.
        ts.factory.createIdentifier('ಠ_ಠ.clutz'), ts.factory.createModuleBlock(globalDeclarations), ts.NodeFlags.Namespace | ts.NodeFlags.NestedNamespace),
    ]), ts.NodeFlags.GlobalAugmentation);
}
/**
 * ambientModuleSymbolFromClutz returns the module's symbol if and only if it is
 * an ambient module that uses tsickle's support for namespace imports (using
 * goog: or declaring the namespace to import in a special
 * __clutz_actual_namespace field).
 */
function ambientModuleSymbolFromClutz(typeChecker, stmt) {
    if (!ts.isImportDeclaration(stmt) && !ts.isExportDeclaration(stmt)) {
        return undefined;
    }
    if (!stmt.moduleSpecifier) {
        return undefined; // can be absent on 'export' statements.
    }
    const moduleSymbol = typeChecker.getSymbolAtLocation(stmt.moduleSpecifier);
    if ((moduleSymbol === null || moduleSymbol === void 0 ? void 0 : moduleSymbol.valueDeclaration) &&
        ts.isSourceFile(moduleSymbol.valueDeclaration)) {
        return undefined;
    }
    const ignoredDiagnostics = [];
    const namespace = googmodule.namespaceForImportUrl(stmt, ignoredDiagnostics, stmt.moduleSpecifier.text, moduleSymbol);
    if (namespace === null)
        return undefined;
    return moduleSymbol;
}
/**
 * Given a QualifiedName (a reference like `foo.bar.baz`), checks if it's a
 * reference into a Clutz symbol, and if so return the underlying ts.Symbol.
 *
 * Note that this function works top-down over the AST: it starts from the
 * QualifiedName and looks at its constituent parts.  It cannot work bottom-up,
 * because sometimes TS generates AST nodes that don't have a parent.
 */
function clutzSymbolFromQualifiedName(typeChecker, qname) {
    // Verify that the innermost reference is the look of disapproval.
    let inner = qname;
    while (ts.isQualifiedName(inner.left)) {
        inner = inner.left;
    }
    if (inner.left.text !== 'ಠ_ಠ' || inner.right.text !== 'clutz') {
        return undefined; // Not a look of disapproval.
    }
    const node = qname.right;
    let sym = typeChecker.getSymbolAtLocation(node);
    if (!sym) {
        // When the declarations transformer has synthesized a reference, for
        // example due to inference, the type checker will not return a symbol
        // underlying the node.  Instead we reach through the TS internals for this.
        // tslint:disable-next-line:no-any circumventing private API
        sym = node['symbol'];
    }
    return sym;
}
/**
 * Given a ts.Node, checks if it's a `foo.bar.baz` reference into a Clutz
 * symbol, and if so return the underlying ts.Symbol.
 */
function clutzSymbolFromNode(typeChecker, node) {
    if (ts.isTypeReferenceNode(node) && ts.isQualifiedName(node.typeName)) {
        // Reference in type position.
        return clutzSymbolFromQualifiedName(typeChecker, node.typeName);
    }
    if (ts.isTypeQueryNode(node) && ts.isQualifiedName(node.exprName)) {
        // Reference in typeof position.
        return clutzSymbolFromQualifiedName(typeChecker, node.exprName);
    }
    return undefined;
}
/**
 * Given a ts.Symbol, returns the import path string to the source of that
 * symbol.
 *
 * This is a path to an underlying d.ts file that defines that symbol, without a
 * file extension.
 */
function importPathForSymbol(sym) {
    if (!sym.declarations || sym.declarations.length === 0) {
        // This can happen if an import or symbol somehow references a nonexistent
        // type, for example in a case where type checking failed or via 'any'.
        return undefined;
    }
    // A Clutz symbol may be multiply defined in the case where a single .js file
    // is a member of multiple libraries.  Typically those will declaration-merge
    // due to having the same Clutz output (though also note that the output can
    // depend on which other files are included in the Clutz run!).  We just need
    // any definition at all, so take the first.
    const clutzFileName = sym.declarations[0].getSourceFile().fileName;
    if (!clutzFileName.endsWith('.d.ts')) {
        throw new Error(`Expected d.ts file for ${sym} but found ${clutzFileName}`);
    }
    return clutzFileName.substring(0, clutzFileName.length - '.d.ts'.length);
}
/**
 * Given a ts.SourceFile, looks for imports/exports that resolve to goog:
 * namespaces and uses the "look of disapproval" namespace, and returns the
 * import paths of the underlying files that define them.
 */
function gatherNecessaryClutzImports(typeChecker, sf) {
    const imports = new Set();
    for (const stmt of sf.statements) {
        // Recurse to find all non-imported accesses to symbols.
        ts.forEachChild(stmt, visit);
        // Then handle explicit import/export statements.
        const moduleSymbol = ambientModuleSymbolFromClutz(typeChecker, stmt);
        if (!moduleSymbol)
            continue;
        const importPath = importPathForSymbol(moduleSymbol);
        if (importPath)
            imports.add(importPath);
    }
    return Array.from(imports);
    /**
     * Recursively searches a node for references to members of the `ಠ_ಠ.clutz`
     * namespace, and adds any referenced source files to the `imports` set.
     * TODO(b/162295026): forbid this pattern and delete this logic.
     */
    function visit(node) {
        const sym = clutzSymbolFromNode(typeChecker, node);
        if (sym) {
            const importPath = importPathForSymbol(sym);
            if (importPath)
                imports.add(importPath);
            // Note: no 'return' here, because we need to also visit children in
            // parameterized types like Foo<Bar>.
        }
        ts.forEachChild(node, visit);
    }
}
//# sourceMappingURL=clutz.js.map