/**
 * @externs
 * @suppress {duplicate,checkTypes}
 */
// NOTE: generated by tsickle, do not edit.

/**
 * @constructor
 * @struct
 * @param {number=} a
 */
function MultipleConstructorsOptional(a) {}

/**
 * @constructor
 * @struct
 * @param {boolean|number} a
 */
function MultipleConstructorsTypes(a) {}

/**
 * @constructor
 * @struct
 * @param {boolean|number} a_or_b
 */
function MultipleConstructorsNamesAndTypes(a_or_b) {}

/**
 * @constructor
 * @struct
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @param {(undefined|string)|(undefined|!Array<string>)=} normal_or_vertexNormals
 * @param {(undefined|boolean)|(undefined|!Array<boolean>)=} color_or_vertexColors
 * @param {(undefined|number)=} materialIndex
 */
function MultipleConstructorsComplexMatrix(a, b, c, normal_or_vertexNormals, color_or_vertexColors, materialIndex) {}

/**
 * @constructor
 * @struct
 * @param {...number|!Array<number>} a
 */
function MultipleConstructorsVariadic(a) {}

/**
 * @constructor
 * @struct
 * @param {...!Array<string>|!Array<number>|string|number} points
 */
function MultipleConstructorsVariadicNames(points) {}
/**
 * @constructor
 * @struct
 */
function OverloadSimpleArgs() {}

/**
 * @param {string|number} a
 * @param {boolean=} b
 * @param {number=} c
 * @param {...?} d
 * @return {void}
 */
OverloadSimpleArgs.prototype.overloaded = function(a, b, c, d) {};
/**
 * @constructor
 * @struct
 */
function OverloadNameVariants() {}

/**
 * @param {string|boolean|number} a_or_b_or_c
 * @return {void}
 */
OverloadNameVariants.prototype.overloaded = function(a_or_b_or_c) {};
/**
 * @constructor
 * @struct
 */
function OverloadReturnTypesNoVoid() {}

/**
 * @param {string} a
 * @param {boolean} b
 * @param {number=} c
 * @return {boolean|number}
 */
OverloadReturnTypesNoVoid.prototype.overloaded = function(a, b, c) {};
/**
 * @constructor
 * @struct
 */
function OverloadReturnTypesWithVoid() {}

/**
 * @param {string} a
 * @param {boolean=} b
 * @param {number=} c
 * @return {void|boolean|number}
 */
OverloadReturnTypesWithVoid.prototype.overloaded = function(a, b, c) {};
/**
 * @constructor
 * @struct
 */
function OverloadBigMix() {}

/**
 * @param {string|number|!Array<!OverloadBigMix>} a_or_c_or_e
 * @param {number=} b
 * @return {void|number|boolean}
 */
OverloadBigMix.prototype.overloaded = function(a_or_c_or_e, b) {};
/**
 * @constructor
 * @struct
 */
function OverloadValueOf() {}

/**
 * @return {string}
 */
OverloadValueOf.prototype.valueOf = function() {};
/**
 * @constructor
 * @struct
 */
function Merged() {}

/**
 * @param {(string|number|!Array<!OverloadBigMix>)} a_or_c_or_e_or_f
 * @param {number} opt_b
 * @return {(void|number|boolean)}
 */
Merged.prototype.overloaded = function(a_or_c_or_e_or_f, opt_b) {};

/**
 * @param {...number} test
 * @return {void}
 */
Merged.prototype.variadic = function(test) {};
/**
 * @constructor
 * @struct
 */
function OverloadTypeArgs() {}

/**
 * @template T, U
 * @param {number|T} a
 * @param {T|U} b
 * @return {T|U}
 */
OverloadTypeArgs.prototype.typeArged = function(a, b) {};
