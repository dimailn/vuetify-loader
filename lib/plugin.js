const url = require('url')
const fs = require('fs')
const path = require('path')
const progressiveLoaderModule = require('../progressive-loader/module')
const { isVueLoader, getVueRules } = require('./getVueRules')

const pluginError = message => new Error(`[VuetifyLoaderPlugin Error] ${message}`)

function resolveConfigFile (styles, context) {
  if (!styles || typeof styles !== 'object' || Array.isArray(styles)) {
    throw pluginError('"styles" must be an object.')
  }
  if (typeof styles.configFile !== 'string' || !styles.configFile) {
    throw pluginError('"styles.configFile" must be a non-empty string.')
  }

  const configFile = path.isAbsolute(styles.configFile)
    ? styles.configFile
    : path.resolve(context, styles.configFile)

  if (!fs.existsSync(configFile)) {
    throw pluginError(`Sass config file not found: ${configFile}`)
  }

  return configFile
}

function resolveVuetifySource (context) {
  let vuetifyPackage

  try {
    vuetifyPackage = require.resolve('vuetify/package.json', { paths: [context] })
  } catch {
    throw pluginError('Cannot resolve "vuetify/package.json" from the webpack context.')
  }

  const vuetifySource = path.join(path.dirname(vuetifyPackage), 'src')
  if (!fs.existsSync(vuetifySource)) {
    throw pluginError(`Vuetify Sass source directory not found: ${vuetifySource}`)
  }

  return vuetifySource
}

function createStylesRule (styles, context) {
  const configFile = resolveConfigFile(styles, context)

  return {
    test: /\.s[ac]ss$/i,
    include: resolveVuetifySource(context),
    enforce: 'pre',
    use: [{
      loader: require.resolve('./loaderStyles'),
      options: { configFile }
    }]
  }
}

class VuetifyLoaderPlugin {
  constructor (options) {
    this.options = options || {}
  }

  apply (compiler) {
    const vueRules = getVueRules(compiler)

    if (!vueRules.length) {
      throw new Error(
        `[VuetifyLoaderPlugin Error] No matching rule for vue-loader found.\n` +
        `Make sure there is at least one root-level rule that uses vue-loader and VuetifyLoaderPlugin is applied after VueLoaderPlugin.`
      )
    }

    if (this.options.styles) {
      compiler.options.module.rules.unshift(
        createStylesRule(
          this.options.styles,
          compiler.context || process.cwd()
        )
      )
    }

    if (this.options.registerStylesSSR) {
      compiler.options.module.rules.unshift({
        test: /\.vue$/,
        resourceQuery: /^$/,
        use: {
          loader: require.resolve('./loaderStyleSSR'),
        }
      })
    }

    compiler.options.module.rules.unshift({
      resourceQuery: /vue&type=template/,
      use: {
        loader: require.resolve('./loader'),
        options: {
          match: this.options.match || [],
          attrsMatch: this.options.attrsMatch || [],
          registerStylesSSR: this.options.registerStylesSSR || false
        }
      },
    })

    vueRules.forEach(this.updateVueRule.bind(this))

    if (this.options.progressiveImages) {
      const options = typeof this.options.progressiveImages === 'boolean'
        ? undefined
        : this.options.progressiveImages
      const resourceQuery = options && options.resourceQuery || 'vuetify-preload'

      compiler.hooks.compilation.tap('VuetifyLoaderPlugin', compilation => {
        compilation.hooks.buildModule.tap('VuetifyLoaderPlugin', module => {
          if (!module.resource) return
          const resource = url.parse(module.resource)
          if (
            resource.query === resourceQuery &&
            ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(resource.pathname))
          ) {
            if (/^asset\/?/.test(module.type)) {
              compilation.errors.push(new Error(
                'vuetify-loader: progressiveImages does not work with asset modules, use file-loader or url-loader\n' +
                `"${module.rawRequest}" will be loaded normally\n` +
                'See https://webpack.js.org/guides/asset-modules/'
              ))
            } else {
              module.loaders.unshift({
                loader: require.resolve('vuetify-loader/progressive-loader'),
                options
              })
            }
          }
        })
      })
    }
  }

  updateVueRule ({ rule }) {
    if (this.options.progressiveImages) {
      const vueLoaderOptions = rule.use.find(isVueLoader).options
      vueLoaderOptions.compilerOptions = vueLoaderOptions.compilerOptions || {}
      vueLoaderOptions.compilerOptions.modules = vueLoaderOptions.compilerOptions.modules || []
      vueLoaderOptions.compilerOptions.modules.push(progressiveLoaderModule)
    }
  }
}

module.exports = VuetifyLoaderPlugin
