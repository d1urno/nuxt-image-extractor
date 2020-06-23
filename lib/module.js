const fs = require('fs')
const { URL } = require('url')
const { join } = require('path')
const axios = require('axios')
const consola = require('consola')

const defaults = {
  path: '/_images', // dir where downloaded images will be stored
  extensions: ['jpg', 'jpeg', 'gif', 'png', 'webp', 'svg'],
  baseUrl: process.env.BASE_URL // cms url
  // TODO: add option to allow keeping the original folder structure
}

module.exports = function Extract(moduleOptions) {
  const options = { ...defaults, ...moduleOptions }
  const baseDir = join(this.options.generate.dir, options.path)

  this.nuxt.hook('generate:distCopied', () => {
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir)
  })

  this.nuxt.hook('export:distCopied', () => {
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir)
  })

  this.nuxt.hook('generate:page', async (page) => {
    return process(page)
  })

  this.nuxt.hook('export:page', async ({ page }) => {
    return process(page)
  })

  async function process(page) {
    const urls = []
    const test = new RegExp('(http(s?):)([/|.|\\w|\\s|-]|%)*.(?:' + options.extensions.join('|') + '){1}[^"]*', 'g')
    const matches = page.html.matchAll(test)
    for (const match of matches) {
      const baseUrl = new URL(moduleOptions.baseUrl)
      const url = new URL(match[0])
      if (baseUrl.hostname === url.hostname && !urls.find((u) => u.href === url.href)) {
        urls.push(url)
      }
    }
    if (!urls.length) return
    consola.info(`${page.route}: nuxt-image-extractor is replacing ${urls.length} images with local copies`)
    return await replaceRemoteImages(page.html, urls).then((html) => (page.html = html))
  }

  async function replaceRemoteImages(html, urls) {
    await Promise.all(
      urls.map(async (url) => {
        const ext = '.' + url.pathname.split('.').pop()
        const name = slugify(url.pathname.split(ext).join('')) + ext
        const imgPath = join(baseDir, name)
        return saveRemoteImage(url.href, imgPath)
          .then(() => {
            html = html.split(url.href).join(options.path + '/' + name)
          })
          .catch((e) => consola.error(e))
      })
    )
    return html
  }
}

function saveRemoteImage(url, path) {
  return axios({
    url,
    responseType: 'stream'
  }).then(
    (response) =>
      new Promise((resolve, reject) => {
        response.data
          .pipe(fs.createWriteStream(path))
          .on('finish', () => resolve())
          .on('error', (e) => reject(e))
      })
  )
}

// https://gist.github.com/codeguy/6684588
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .trim()
    .replace('/', '')
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '-')
    .replace(/\-\-+/g, '-')
}

module.exports.meta = require('../package.json')
