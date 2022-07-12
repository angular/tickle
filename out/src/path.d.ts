/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
declare module 'typescript' {
    function isRootedDiskPath(path: string): boolean;
    function combinePaths(...paths: string[]): string;
    function getDirectoryPath(path: string): string;
    function convertToRelativePath(absoluteOrRelativePath: string, basePath: string, getCanonicalFileName: (path: string) => string): string;
    function resolvePath(path: string, ...paths: Array<string | undefined>): string;
}
export declare function isAbsolute(path: string): boolean;
export declare function join(p1: string, p2: string): string;
export declare function dirname(path: string): string;
export declare function relative(base: string, rel: string): string;
export declare function normalize(path: string): string;
