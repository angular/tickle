/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
/**
 * @fileoverview Externs creates Closure Compiler #externs definitions from the
 * ambient declarations in a TypeScript file.
 *
 * (Note that we cannot write the "@" form of the externs tag, even in comments,
 * because the compiler greps for it in source files(!).  So we write #externs
 * instead.)
 *
 * For example, a
 *   declare interface Foo { bar: string; }
 *
 * Would generate a
 *   /.. #externs ./
 *   /.. @record ./
 *   var Foo = function() {};
 *   /.. @type {string} ./
 *   Foo.prototype.bar;
 *
 * The generated externs indicate to Closure Compiler that symbols are external
 * to the optimization process, i.e. they are provided by outside code. That
 * most importantly means they must not be renamed or removed.
 *
 * A major difficulty here is that TypeScript supports module-scoped external
 * symbols; `.d.ts` files can contain `export`s and `import` other files.
 * Closure Compiler does not have such a concept, so tsickle must emulate the
 * behaviour. It does so by following this scheme:
 *
 * 1. non-module .d.ts produces global symbols
 * 2. module .d.ts produce symbols namespaced to the module, by creating a
 *    mangled name matching the current file's path. tsickle expects outside
 *    code (e.g. build system integration or manually written code) to contain a
 *    goog.module/provide that references the mangled path.
 * 3. declarations in `.ts` files produce types that can be separately emitted
 *    in e.g. an `externs.js`, using `getGeneratedExterns` below.
 *    1. non-exported symbols produce global types, because that's what users
 *       expect and it matches TypeScripts emit, which just references `Foo` for
 *       a locally declared symbol `Foo` in a module. Arguably these should be
 *       wrapped in `declare global { ... }`.
 *    2. exported symbols are scoped to the `.ts` file by prefixing them with a
 *       mangled name. Exported types are re-exported from the JavaScript
 *       `goog.module`, allowing downstream code to reference them. This has the
 *       same problem regarding ambient values as above, it is unclear where the
 *       value symbol would be defined, so for the time being this is
 *       unsupported.
 *
 * The effect of this is that:
 * - symbols in a module (i.e. not globals) are generally scoped to the local
 *   module using a mangled name, preventing symbol collisions on the Closure
 *   side.
 * - importing code can unconditionally refer to and import any symbol defined
 *   in a module `X` as `path.to.module.X`, regardless of whether the defining
 *   location is a `.d.ts` file or a `.ts` file, and regardless whether the
 *   symbol is ambient (assuming there's an appropriate shim).
 * - if there is a shim present, tsickle avoids emitting the Closure namespace
 *   itself, expecting the shim to provide the namespace and initialize it to a
 *   symbol that provides the right value at runtime (i.e. the implementation of
 *   whatever third party library the .d.ts describes).
 */
import * as ts from 'typescript';
import { AnnotatorHost } from './annotator_host';
/**
 * Concatenate all generated externs definitions together into a string,
 * including a file comment header.
 *
 * @param rootDir Project root.  Emitted comments will reference paths relative
 *     to this root.
 */
export declare function getGeneratedExterns(externs: {
    [fileName: string]: string;
}, rootDir: string): string;
/**
 * generateExterns generates extern definitions for all ambient declarations in the given source
 * file. It returns a string representation of the Closure JavaScript, not including the initial
 * comment with \@fileoverview and #externs (see above for that).
 */
export declare function generateExterns(typeChecker: ts.TypeChecker, sourceFile: ts.SourceFile, host: AnnotatorHost, moduleResolutionHost: ts.ModuleResolutionHost, options: ts.CompilerOptions): {
    output: string;
    diagnostics: ts.Diagnostic[];
};
