const fs = require('fs')
const path = require('path')
const loaderUtils = require('loader-utils')

function getOptions (loaderContext) {
  return typeof loaderContext.getOptions === 'function'
    ? loaderContext.getOptions()
    : loaderUtils.getOptions(loaderContext)
}

function sassUrl (file) {
  return file
    .split(path.sep)
    .join('/')
    .replace(/(["\\])/g, '\\$1')
}

module.exports = function vuetifyStylesLoader (source, sourceMap) {
  this.cacheable && this.cacheable()

  const options = getOptions(this) || {}
  if (!options.configFile) {
    throw new Error('[VuetifyLoaderPlugin Error] styles.configFile is required.')
  }

  const configFile = path.isAbsolute(options.configFile)
    ? options.configFile
    : path.resolve(this.rootContext || process.cwd(), options.configFile)

  if (!fs.existsSync(configFile)) {
    throw new Error(`[VuetifyLoaderPlugin Error] Sass config file not found: ${configFile}`)
  }

  this.addDependency(configFile)

  const terminator = path.extname(this.resourcePath).toLowerCase() === '.sass' ? '' : ';'
  const content = `@use "${sassUrl(configFile)}"${terminator}\n${source}`

  if (this.callback) {
    this.callback(null, content, sourceMap)
    return
  }

  return content
}
