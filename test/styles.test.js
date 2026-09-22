const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const webpack = require('webpack')

const VuetifyLoaderPlugin = require('../lib/plugin')
const stylesLoader = require('../lib/loaderStyles')

function fixture () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vuetify-loader-'))
  const vuetifyRoot = path.join(root, 'node_modules', 'vuetify')
  fs.mkdirSync(path.join(vuetifyRoot, 'src'), { recursive: true })
  fs.writeFileSync(path.join(vuetifyRoot, 'package.json'), JSON.stringify({ name: 'vuetify' }))

  const settingsFile = path.join(vuetifyRoot, 'src', '_settings.scss')
  fs.writeFileSync(settingsFile, '$brand-color: #000000 !default;\n')
  fs.writeFileSync(
    path.join(root, 'variables.scss'),
    `@use "${settingsFile.split(path.sep).join('/')}" with ($brand-color: #123456);\n`
  )

  return { root, vuetifyRoot, configFile: path.join(root, 'variables.scss') }
}

function fakeCompiler ({ root }) {
  return {
    context: root,
    options: {
      module: {
        rules: [{
          test: /\.vue$/,
          use: [{ loader: 'vue-loader', ident: 'vue-loader-options' }]
        }]
      }
    },
    hooks: {}
  }
}

function runStylesLoader ({ resourcePath, configFile, source }) {
  const dependencies = []
  let result
  const context = {
    resourcePath,
    rootContext: path.dirname(configFile),
    cacheable () {},
    getOptions: () => ({ configFile }),
    addDependency: file => dependencies.push(file),
    callback: (error, content) => {
      if (error) throw error
      result = content
    }
  }

  stylesLoader.call(context, source)
  return { result, dependencies }
}

function compile (config) {
  return new Promise((resolve, reject) => {
    webpack(config, (error, stats) => {
      if (error) return reject(error)
      if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })))
      resolve(stats)
    })
  })
}

test('prepends valid module syntax for SCSS and watches the config file', () => {
  const files = fixture()
  const resourcePath = path.join(files.vuetifyRoot, 'src', 'component.scss')
  const { result, dependencies } = runStylesLoader({
    resourcePath,
    configFile: files.configFile,
    source: '.component { color: red; }'
  })

  assert.match(result, /^@use ".+variables\.scss";\n/)
  assert.deepEqual(dependencies, [files.configFile])
})

test('prepends semicolon-free module syntax for indented Sass', () => {
  const files = fixture()
  const resourcePath = path.join(files.vuetifyRoot, 'src', 'component.sass')
  const { result } = runStylesLoader({
    resourcePath,
    configFile: files.configFile,
    source: '.component\n  color: red\n'
  })

  assert.match(result, /^@use ".+variables\.scss"\n/)
})

test('plugin limits the pre-loader to Vuetify Sass sources', () => {
  const files = fixture()
  const compiler = fakeCompiler(files)
  const plugin = new VuetifyLoaderPlugin({
    styles: {
      configFile: files.configFile
    }
  })

  plugin.apply(compiler)

  const rule = compiler.options.module.rules.find(rule => rule.enforce === 'pre' && String(rule.test).includes('s[ac]ss'))
  assert.ok(rule)
  assert.equal(rule.include, path.join(files.vuetifyRoot, 'src'))
  assert.equal(rule.use[0].options.configFile, files.configFile)
})

for (const syntax of ['scss', 'sass']) {
  test(`webpack compiles configured Vuetify ${syntax.toUpperCase()} without application injection`, async () => {
    const files = fixture()
    const entry = path.join(files.vuetifyRoot, 'src', `component.${syntax}`)
    const output = path.join(files.root, 'dist')
    const source = syntax === 'scss'
      ? '@use "settings";\n.component { color: settings.$brand-color; }\n'
      : '@use "settings"\n.component\n  color: settings.$brand-color\n'
    fs.writeFileSync(entry, source)

    const noopLoader = path.join(files.root, 'noop-loader.js')
    fs.writeFileSync(noopLoader, 'module.exports = source => source\n')

    const plugin = new VuetifyLoaderPlugin({
      styles: {
        configFile: files.configFile
      }
    })

    const stats = await compile({
      mode: 'development',
      context: files.root,
      entry,
      output: { path: output, filename: 'bundle.js' },
      module: {
        rules: [
          {
            test: /\.vue$/,
            use: [{ loader: noopLoader, ident: 'vue-loader-options' }]
          },
          {
            test: new RegExp(`\\.${syntax}$`),
            use: [
              require.resolve('css-loader'),
              {
                loader: require.resolve('sass-loader'),
                options: {
                  implementation: require('sass'),
                  api: 'modern',
                  sassOptions: syntax === 'sass' ? { indentedSyntax: true } : {}
                }
              }
            ]
          }
        ]
      },
      plugins: [plugin]
    })

    assert.ok(stats.compilation.getAsset('bundle.js'))
    const bundle = fs.readFileSync(path.join(output, 'bundle.js'), 'utf8')
    assert.match(bundle, /#123456/)
  })
}
