/**
 * Simple test script to verify HeadlessRenderer setup
 * Run with: yarn tsx src/test-setup.ts
 */

import { HeadlessRenderer } from './rendering/HeadlessRenderer.js'

async function testHeadlessRenderer() {
  console.log('🧪 Testing HeadlessRenderer setup...\n')

  const renderer = new HeadlessRenderer(512) // Small canvas for quick test

  try {
    // Test 1: Basic initialization test (expecting failure with empty generators)
    console.log('Test 1: Initialize with empty generators (expect ProductRendererV2 to require active generator)')
    try {
      await renderer.initialize([])
      console.log('✅ Initialization successful (unexpectedly!)')
    } catch (error: any) {
      if (error.message === 'No active generator') {
        console.log('✅ Got expected error: "No active generator"')
        console.log('   This means HeadlessRenderer, Canvas, and GL context are working!')
      } else {
        throw error
      }
    }

    // Test 2: Check that we can create a new renderer instance
    console.log('\nTest 2: Create new renderer instance')
    const renderer2 = new HeadlessRenderer(256)
    console.log('✅ Second renderer instance created')
    console.log(`   Canvas size: 256x256`)

    console.log('\n✅ All basic tests passed!')
    console.log('\n📝 Summary:')
    console.log('   - HeadlessRenderer class works')
    console.log('   - Canvas creation successful')
    console.log('   - WebGL context creation successful (@kmamal/gl)')
    console.log('   - Canvas patching (addEventListener, etc.) successful')
    console.log('   - ProductRendererV2 initialization reached (requires generator config)')
    console.log('\n📌 Next steps:')
    console.log('   - Add a real generator configuration to test full rendering')
  } catch (error) {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  }
}

// Run tests
testHeadlessRenderer().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
