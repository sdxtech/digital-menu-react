import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { resolveDocumentTitle } from '../src/lib/document-title.ts'

test('every registered route across all roles has a document title', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const app = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const paths = new Set<string>()

  const visit = (node: ts.Node, parentPath = '') => {
    let currentPath = parentPath
    const element = ts.isJsxElement(node) ? node.openingElement
      : ts.isJsxSelfClosingElement(node) ? node : undefined
    if (element?.tagName.getText(app) === 'Route') {
      const path = element.attributes.properties.find((attribute) =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(app) === 'path',
      )
      if (path && ts.isJsxAttribute(path)) {
        assert.ok(path.initializer && ts.isStringLiteral(path.initializer), 'Route paths must be checked for title coverage')
        const value = path.initializer.text
        if (value === '*') return
        currentPath = value.startsWith('/') ? value : `${parentPath}/${value}`
        paths.add(currentPath)
      }
    }
    ts.forEachChild(node, (child) => visit(child, currentPath))
  }
  visit(app)

  for (const role of ['chef', 'corporate-chef', 'unit-manager', 'executive', 'admin-site', 'storekeeper', 'superadmin']) {
    assert.ok(paths.has(`/${role}`), `Missing route coverage for ${role}`)
  }
  for (const path of paths) {
    assert.notEqual(resolveDocumentTitle(path, null), 'Page Not Found | SPICES', `Missing document title: ${path}`)
    if (path !== '/') {
      assert.notEqual(resolveDocumentTitle(path, null), 'SPICES', `Missing page name: ${path}`)
      assert.equal(resolveDocumentTitle(`${path}/`, null), resolveDocumentTitle(path, null))
    }
  }
})

for (const role of ['chef', 'corporate-chef', 'superadmin']) {
  test(`${role} recipe pages show draft, create, and edit titles`, () => {
    assert.equal(resolveDocumentTitle(`/${role}/recipe-drafts`, null), 'Recipe Drafts | SPICES')
    const path = `/${role}/menu-create`
    assert.equal(resolveDocumentTitle(path, null), 'Create New Recipe | SPICES')
    assert.equal(resolveDocumentTitle(path, { baseRecipe: { id: 'recipe-1', name: ' Rice ' } }), 'Edit Recipe: Rice | SPICES')
    assert.equal(resolveDocumentTitle(path, { baseRecipe: { id: 'recipe-1' } }), 'Edit Recipe | SPICES')
    assert.equal(resolveDocumentTitle(path, { baseRecipe: { name: 'Template' } }), 'Create New Recipe | SPICES')
  })
}

test('unknown routes still show Page Not Found', () => {
  for (const path of ['/unknown', '/superadmin/unknown', '/chef/menu-create/unknown']) {
    assert.equal(resolveDocumentTitle(path, null), 'Page Not Found | SPICES')
  }
  assert.equal(resolveDocumentTitle('/', null), 'SPICES')
})
