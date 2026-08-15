'use strict';

/**
 * Registro de implementaciones.
 *
 * Cada clave debe existir en el catálogo y viceversa; lo comprueba
 * tests/contract/catalog.test.js.
 */

const IMPLEMENTATIONS = {
  ...require('./impl/status'),
  ...require('./impl/workspace'),
  ...require('./impl/memory'),
  ...require('./impl/terminal'),
  ...require('./impl/git'),
  ...require('./impl/desktop'),
  ...require('./impl/network'),
};

module.exports = { IMPLEMENTATIONS };
