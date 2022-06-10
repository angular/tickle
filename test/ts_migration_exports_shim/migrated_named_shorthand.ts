/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

/**
 * See what happens when we use the shorthand syntax for shimming named
 * exports.
 */

export const someConstant = 42;

const notDelete = 'actually delete';
export {notDelete as delete};

goog.tsMigrationNamedExportsShim('migrated.module.named_shorthand');
