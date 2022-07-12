"use strict";
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @fileoverview Type-checks all d.ts files found in the test tree.
 * This verifies that the d.ts we generate as a product of compilation
 * are valid.
 *
 * In general, .d.ts are generated by the TypeScript compiler, not tsickle, but
 * we do some transforms of those .d.ts files for Clutz interop (see
 * src/clutz.ts) and this test helps verify those transforms generate valid
 * compileable output.
 */
const fs = require("fs");
const ts = require("typescript");
const testSupport = require("./test_support");
describe('clutz dts', () => {
    beforeEach(() => {
        testSupport.addDiffMatchers();
    });
    it('produces a valid .d.ts', () => {
        const dtsSources = new Map();
        for (const tsPath of testSupport.allDtsPaths()) {
            const tsSource = fs.readFileSync(tsPath, 'utf-8');
            dtsSources.set(tsPath, tsSource);
        }
        const program = testSupport.createProgram(dtsSources);
        const diagnostics = ts.getPreEmitDiagnostics(program);
        testSupport.expectDiagnosticsEmpty(diagnostics);
    });
});
//# sourceMappingURL=e2e_clutz_dts_test.js.map