const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  // Never ship source maps: they expose the full source tree.
  productionSourceMap: false
})
