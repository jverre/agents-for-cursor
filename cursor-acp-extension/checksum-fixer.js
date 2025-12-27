const fs = require('fs').promises;
const crypto = require('crypto');
const path = require('path');
const vscode = require('vscode');

// Get product.json path
function getProductJsonPath() {
    return path.join(vscode.env.appRoot, 'product.json');
}

// Get backup path for product.json
function getProductJsonBackupPath() {
    return getProductJsonPath() + '.backup';
}

// Calculate MD5 checksum of a file
async function calculateMD5(filePath) {
    try {
        const content = await fs.readFile(filePath);
        return crypto.createHash('md5').update(content).digest('hex');
    } catch (error) {
        throw new Error(`Failed to calculate MD5 for ${filePath}: ${error.message}`);
    }
}

// Calculate SHA256 checksum in base64 format (Cursor's format)
async function calculateSHA256Base64(filePath) {
    try {
        const content = await fs.readFile(filePath);
        return crypto.createHash('sha256').update(content).digest('base64');
    } catch (error) {
        throw new Error(`Failed to calculate SHA256 for ${filePath}: ${error.message}`);
    }
}

// Fix checksums in product.json
async function fixChecksums() {
    const productJsonPath = getProductJsonPath();
    const backupPath = getProductJsonBackupPath();

    console.log('Fixing checksums in product.json...');

    // Read product.json
    let product;
    try {
        const content = await fs.readFile(productJsonPath, 'utf8');
        product = JSON.parse(content);
    } catch (error) {
        throw new Error(`Failed to read product.json: ${error.message}`);
    }

    // Create backup if it doesn't exist
    try {
        await fs.access(backupPath);
        console.log('product.json backup already exists');
    } catch {
        console.log('Creating product.json backup...');
        await fs.writeFile(backupPath, JSON.stringify(product, null, '\t'), 'utf8');
    }

    // Initialize checksums object if needed
    if (!product.checksums) {
        product.checksums = {};
    }

    // Calculate new checksum for bootstrap workbench.js
    const bootstrapKey = 'vs/code/electron-sandbox/workbench/workbench.js';
    const bootstrapAbsolutePath = path.join(vscode.env.appRoot, 'out/vs/code/electron-sandbox/workbench/workbench.js');

    console.log('Calculating checksum for bootstrap workbench:', bootstrapAbsolutePath);
    const bootstrapChecksum = await calculateSHA256Base64(bootstrapAbsolutePath);
    console.log('Bootstrap workbench checksum:', bootstrapChecksum);
    console.log('Old bootstrap checksum:', product.checksums[bootstrapKey]);
    product.checksums[bootstrapKey] = bootstrapChecksum;

    // Calculate new checksum for main workbench.desktop.main.js
    const mainKey = 'vs/workbench/workbench.desktop.main.js';
    const mainAbsolutePath = path.join(vscode.env.appRoot, 'out/vs/workbench/workbench.desktop.main.js');

    console.log('Calculating checksum for main workbench:', mainAbsolutePath);
    const mainChecksum = await calculateSHA256Base64(mainAbsolutePath);
    console.log('Main workbench checksum:', mainChecksum);
    console.log('Old main checksum:', product.checksums[mainKey]);
    product.checksums[mainKey] = mainChecksum;

    // Write updated product.json
    try {
        await fs.writeFile(productJsonPath, JSON.stringify(product, null, '\t'), 'utf8');
        console.log('Checksums updated successfully for both workbench files');
    } catch (error) {
        throw new Error(`Failed to write product.json: ${error.message}`);
    }
}

// Restore original checksums
async function restoreChecksums() {
    const productJsonPath = getProductJsonPath();
    const backupPath = getProductJsonBackupPath();

    console.log('Restoring original checksums...');

    // Check if backup exists
    try {
        await fs.access(backupPath);
    } catch {
        console.log('No product.json backup found');
        return;
    }

    // Restore from backup
    try {
        const backupContent = await fs.readFile(backupPath, 'utf8');
        await fs.writeFile(productJsonPath, backupContent, 'utf8');
        console.log('product.json restored from backup');
    } catch (error) {
        throw new Error(`Failed to restore product.json: ${error.message}`);
    }
}

module.exports = {
    fixChecksums,
    restoreChecksums,
    calculateMD5,
    calculateSHA256Base64,
    getProductJsonPath
};
