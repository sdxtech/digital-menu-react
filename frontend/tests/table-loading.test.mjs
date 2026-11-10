import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)

// Compile the real TSX components for Node's test runner without a DOM dependency.
const loadComponent = (name, react = React) => {
  const source = readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  })
  const module = { exports: {} }
  const localRequire = (path) => path === 'react' ? react
    : path.startsWith('./') ? { default: loadComponent(path.slice(2), react) } : require(path)
  new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports)
  return module.exports.default
}

const TableBody = loadComponent('LoadingTableBody')
const data = React.createElement('tr', null, React.createElement('td', null, 'Saved recipe'))
const render = (props) => renderToStaticMarkup(React.createElement('table', null,
  React.createElement(TableBody, { loading: true, columns: 4, rowCount: 0, pageSize: 10, ...props }, data)))

test('first load renders a skeleton grid matching the table columns and page size', () => {
  const html = render({ label: 'Loading recipes...' })
  assert.equal((html.match(/dm-table-skeleton/g) ?? []).length, 40)
  assert.match(html, /colSpan="4"/i)
  assert.match(html, /role="status"/)
  assert.match(html, /Loading recipes/)
  assert.match(html, /aria-busy="true"/)
  assert.doesNotMatch(html, /Saved recipe/)
})

test('dynamic columns and shorter pages retain their own table shape', () => {
  assert.equal((render({ columns: 7, rowCount: 3 }).match(/dm-table-skeleton/g) ?? []).length, 21)
  assert.equal((render({ rowCount: 100 }).match(/dm-table-skeleton/g) ?? []).length, 40)
})

test('settled tables render their content without a loading announcement or disabled actions', () => {
  const html = render({ loading: false, rowCount: 1 })
  assert.match(html, /Saved recipe/)
  assert.doesNotMatch(html, /dm-table-skeleton|role="status"|inert=/)
  assert.match(html, /aria-busy="false"/)
})

// Model React's state slots and render retries to exercise consecutive prop updates.
const createTableInstance = () => {
  const slots = []
  let index = 0
  let changed = false
  const Component = loadComponent('LoadingTableBody', {
    ...React,
    useState(initial) {
      const slot = index++
      if (!(slot in slots)) slots[slot] = initial
      return [slots[slot], (value) => {
        if (!Object.is(slots[slot], value)) { slots[slot] = value; changed = true }
      }]
    },
  })
  return (props) => {
    let element
    let attempts = 0
    do {
      assert.ok(attempts++ < 10, 'loading state should settle')
      index = 0
      changed = false
      element = Component({ columns: 4, pageSize: 10, children: data, ...props })
    } while (changed)
    return renderToStaticMarkup(React.createElement('table', null, element))
  }
}

test('refresh keeps loaded rows visible and blocks their actions until the request settles', () => {
  const renderUpdate = createTableInstance()
  renderUpdate({ loading: true, rowCount: 0 })
  renderUpdate({ loading: false, rowCount: 1 })
  const html = renderUpdate({ loading: true, rowCount: 1 })
  assert.match(html, /Saved recipe/)
  assert.match(html, /Updating data/)
  assert.match(html, /inert=""/)
  assert.doesNotMatch(html, /dm-table-skeleton/)
  assert.doesNotMatch(renderUpdate({ loading: false, rowCount: 1 }), /inert=""|Updating data/)
})

test('a new page or filter gets a fresh loading instance instead of displaying old results', () => {
  const previous = createTableInstance()
  previous({ loading: true, rowCount: 0 })
  previous({ loading: false, rowCount: 1 })
  const nextQuery = createTableInstance()
  const html = nextQuery({ loading: true, rowCount: 1 })
  assert.match(html, /dm-table-skeleton/)
  assert.doesNotMatch(html, /Saved recipe|Updating data/)
})

test('empty and failed requests stop the skeleton and expose the supplied result', () => {
  for (const result of ['No recipes found.', 'Could not load recipes.']) {
    const renderUpdate = createTableInstance()
    renderUpdate({ loading: true, rowCount: 0 })
    const children = React.createElement('tr', null, React.createElement('td', null, result))
    const html = renderUpdate({ loading: false, rowCount: 0, children })
    assert.ok(html.includes(result))
    assert.doesNotMatch(html, /dm-table-skeleton|inert=""/)
  }
})

test('a failed table offers retry only after loading has stopped', () => {
  const props = { error: 'Request failed.', onRetry: () => {} }
  assert.match(render({ ...props, loading: false }), /Try again/)
  assert.doesNotMatch(render({ ...props, loading: true }), /Try again/)
  assert.doesNotMatch(render({ ...props, loading: false, error: '' }), /Try again/)
})

test('reduced motion leaves skeletons static and spinner animation requires motion-safe', () => {
  const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.dm-table-skeleton/)
  assert.match(render({}), /motion-safe:animate-spin/)
})
