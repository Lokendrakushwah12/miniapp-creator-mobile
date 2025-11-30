/**
 * Parse deployment errors from Vercel/Railway build logs
 * and convert them into actionable error messages for the LLM
 * 
 * Comprehensive parser that catches ALL error types:
 * - TypeScript type errors
 * - Syntax errors (Unexpected token, etc.)
 * - JSX parsing errors
 * - Module not found errors
 * - Import/export errors
 * - ESLint errors
 * - SWC/Babel compilation errors
 * - Generic build errors
 */

export interface DeploymentError {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning';
  category: 'typescript' | 'eslint' | 'build' | 'runtime' | 'syntax' | 'module' | 'jsx';
  code?: string;
  context?: string;
}

export interface ParsedDeploymentErrors {
  errors: DeploymentError[];
  hasTypeScriptErrors: boolean;
  hasESLintErrors: boolean;
  hasBuildErrors: boolean;
  hasSyntaxErrors: boolean;
  hasModuleErrors: boolean;
  summary: string;
  rawError?: string; // Include raw error for fallback
}

/**
 * Parse Vercel deployment error logs - COMPREHENSIVE VERSION
 * Catches ALL error types, not just TypeScript type errors
 */
export function parseVercelDeploymentErrors(
  errorOutput: string,
  logs: string
): ParsedDeploymentErrors {
  const errors: DeploymentError[] = [];
  const allLogs = `${errorOutput}\n${logs}`;
  const processedMessages = new Set<string>(); // Avoid duplicate errors

  let match;

  // ============================================================
  // 1. TypeScript Type Errors
  // Format: ./src/app/page.tsx:158:11
  //         Type error: Type 'number[][]' is not assignable to type ...
  // ============================================================
  const tsErrorRegex = /\.\/([^:\s]+):(\d+):(\d+)\s*\n\s*Type error:\s*([^\n]+)/g;
  while ((match = tsErrorRegex.exec(allLogs)) !== null) {
    const [, file, line, column, message] = match;
    const msgKey = `${file}:${line}:${message}`;
    if (!processedMessages.has(msgKey)) {
      processedMessages.add(msgKey);
      errors.push({
        file: file.trim(),
        line: parseInt(line),
        column: parseInt(column),
        message: `TypeScript: ${message.trim()}`,
        severity: 'error',
        category: 'typescript',
        code: 'TS_TYPE_ERROR',
      });
    }
  }

  // ============================================================
  // 2. Generic File-Based Errors (Syntax, JSX, etc.)
  // Format: ./src/file.tsx:111:6
  //         Unexpected token `DndContext`. Expected jsx identifier
  // This catches errors WITHOUT "Type error:" prefix
  // ============================================================
  const genericFileErrorRegex = /\.\/([^:\s]+):(\d+):(\d+)\s*\n\s*(?!Type error:)([A-Z][^\n]+)/g;
  while ((match = genericFileErrorRegex.exec(allLogs)) !== null) {
    const [, file, line, column, message] = match;
    const msgKey = `${file}:${line}:${message}`;
    if (!processedMessages.has(msgKey)) {
      processedMessages.add(msgKey);
      
      // Determine category based on message content
      let category: DeploymentError['category'] = 'syntax';
      if (message.toLowerCase().includes('jsx') || message.includes('Expected jsx')) {
        category = 'jsx';
      } else if (message.includes('import') || message.includes('export')) {
        category = 'module';
      }
      
      errors.push({
        file: file.trim(),
        line: parseInt(line),
        column: parseInt(column),
        message: message.trim(),
        severity: 'error',
        category,
        code: 'SYNTAX_ERROR',
      });
    }
  }

  // ============================================================
  // 3. SWC/Babel Compilation Errors
  // Format: × Unexpected token `token`. Expected ...
  //         ╭─[file.tsx:line:col]
  // ============================================================
  const swcErrorRegex = /[×✕]\s*([^\n]+)(?:\s*\n\s*[╭├│╰]─?\[?([^\]:\n]+)?:?(\d+)?:?(\d+)?\]?)?/g;
  while ((match = swcErrorRegex.exec(allLogs)) !== null) {
    const [, message, file, line, column] = match;
    const msgKey = `swc:${message}`;
    if (!processedMessages.has(msgKey) && message) {
      processedMessages.add(msgKey);
      errors.push({
        file: file?.trim(),
        line: line ? parseInt(line) : undefined,
        column: column ? parseInt(column) : undefined,
        message: `SWC: ${message.trim()}`,
        severity: 'error',
        category: 'syntax',
        code: 'SWC_ERROR',
      });
    }
  }

  // ============================================================
  // 4. Module Not Found Errors
  // Format: Module not found: Can't resolve 'package-name'
  //         Module not found: Can't resolve '@/components/...'
  // ============================================================
  const moduleNotFoundRegex = /Module not found:\s*([^\n]+)/g;
  while ((match = moduleNotFoundRegex.exec(allLogs)) !== null) {
    const [, message] = match;
    const msgKey = `module:${message}`;
    if (!processedMessages.has(msgKey)) {
      processedMessages.add(msgKey);
      
      // Try to extract the module name
      const moduleMatch = message.match(/(?:Can't resolve|Cannot find module)\s*['"]([^'"]+)['"]/);
      const moduleName = moduleMatch ? moduleMatch[1] : message;
      
      errors.push({
        message: `Module not found: ${moduleName}`,
        severity: 'error',
        category: 'module',
        code: 'MODULE_NOT_FOUND',
        context: message.trim(),
      });
    }
  }

  // ============================================================
  // 5. Import/Export Syntax Errors
  // Format: SyntaxError: ... import/export ...
  // ============================================================
  const importExportErrorRegex = /SyntaxError:\s*([^\n]*(?:import|export)[^\n]*)/gi;
  while ((match = importExportErrorRegex.exec(allLogs)) !== null) {
    const [, message] = match;
    const msgKey = `import:${message}`;
    if (!processedMessages.has(msgKey)) {
      processedMessages.add(msgKey);
      errors.push({
        message: `Import/Export Error: ${message.trim()}`,
        severity: 'error',
        category: 'module',
        code: 'IMPORT_EXPORT_ERROR',
      });
    }
  }

  // ============================================================
  // 6. ESLint Configuration Errors
  // Format: ESLint: Invalid Options: - Unknown options: useEslintrc, extensions
  // ============================================================
  const eslintConfigRegex = /ESLint:\s*Invalid Options:\s*([^\n]+)/g;
  while ((match = eslintConfigRegex.exec(allLogs)) !== null) {
    const [, message] = match;
    const msgKey = `eslint-config:${message}`;
    if (!processedMessages.has(msgKey)) {
      processedMessages.add(msgKey);
      errors.push({
        message: `ESLint Config: ${message.trim()}`,
        severity: 'error',
        category: 'eslint',
        code: 'ESLINT_CONFIG',
      });
    }
  }

  // ============================================================
  // 7. General ESLint Errors (with file context)
  // Format: ./src/file.tsx
  //         7:5  Error: 'variable' is assigned a value but never used.
  // ============================================================
  const eslintFileErrorRegex = /\.\/([^:\s\n]+)\s*\n\s*(\d+):(\d+)\s+(Error|Warning|error|warning):\s*([^\n]+)/g;
  while ((match = eslintFileErrorRegex.exec(allLogs)) !== null) {
    const [, file, line, column, severity, message] = match;
    const msgKey = `eslint:${file}:${line}:${message}`;
    if (!processedMessages.has(msgKey)) {
      processedMessages.add(msgKey);
      errors.push({
        file: file.trim(),
        line: parseInt(line),
        column: parseInt(column),
        message: message.trim(),
        severity: severity.toLowerCase() === 'error' ? 'error' : 'warning',
        category: 'eslint',
        code: 'ESLINT_ERROR',
      });
    }
  }

  // ============================================================
  // 8. Inline ESLint Errors
  // Format: ESLint: 7:5 - Error: 'variable' is assigned...
  // ============================================================
  const eslintInlineRegex = /ESLint:\s*(\d+):(\d+)\s*-\s*(Error|Warning):\s*(.+?)(?:\s*\(([^)]+)\))?(?:\n|$)/g;
  while ((match = eslintInlineRegex.exec(allLogs)) !== null) {
    const [, line, column, severity, message, rule] = match;
    const msgKey = `eslint-inline:${line}:${message}`;
    if (!processedMessages.has(msgKey)) {
      processedMessages.add(msgKey);
      errors.push({
        line: parseInt(line),
        column: parseInt(column),
        message: rule ? `${message.trim()} (${rule})` : message.trim(),
        severity: severity.toLowerCase() === 'error' ? 'error' : 'warning',
        category: 'eslint',
        code: rule || 'ESLINT_ERROR',
      });
    }
  }

  // ============================================================
  // 9. Build Command Errors
  // Format: Error: Command "npm run build" exited with 1
  // ============================================================
  const buildErrorRegex = /Error:\s*Command\s*"([^"]+)"\s*exited\s*with\s*(\d+)/g;
  while ((match = buildErrorRegex.exec(allLogs)) !== null) {
    const [, command, exitCode] = match;
    const msgKey = `build:${command}:${exitCode}`;
    if (!processedMessages.has(msgKey)) {
      processedMessages.add(msgKey);
      errors.push({
        message: `Build failed: ${command} exited with code ${exitCode}`,
        severity: 'error',
        category: 'build',
        code: 'BUILD_ERROR',
      });
    }
  }

  // ============================================================
  // 10. "Failed to compile" with context
  // ============================================================
  if (allLogs.includes('Failed to compile')) {
    const failedCompileRegex = /Failed to compile\.\s*\n\s*\n\s*([^\n]+)/;
    const failedMatch = failedCompileRegex.exec(allLogs);
    if (failedMatch) {
      const context = failedMatch[1].trim();
      const msgKey = `compile:${context}`;
      if (!processedMessages.has(msgKey)) {
        processedMessages.add(msgKey);
        errors.push({
          message: 'Compilation failed',
          severity: 'error',
          category: 'build',
          code: 'COMPILE_ERROR',
          context,
        });
      }
    }
  }

  // ============================================================
  // 11. Next.js Specific Errors
  // Format: Error: ... in /path/to/file
  // ============================================================
  const nextjsErrorRegex = /Error:\s*([^\n]+)\s+in\s+([^\s\n]+)/g;
  while ((match = nextjsErrorRegex.exec(allLogs)) !== null) {
    const [, message, file] = match;
    const msgKey = `nextjs:${file}:${message}`;
    if (!processedMessages.has(msgKey)) {
      processedMessages.add(msgKey);
      errors.push({
        file: file.replace(/^.*\/src\//, 'src/').trim(),
        message: message.trim(),
        severity: 'error',
        category: 'build',
        code: 'NEXTJS_ERROR',
      });
    }
  }

  // ============================================================
  // 12. React/JSX Specific Errors
  // ============================================================
  const reactErrorRegex = /(?:React|JSX)\s+(?:error|Error):\s*([^\n]+)/g;
  while ((match = reactErrorRegex.exec(allLogs)) !== null) {
    const [, message] = match;
    const msgKey = `react:${message}`;
    if (!processedMessages.has(msgKey)) {
      processedMessages.add(msgKey);
      errors.push({
        message: `React/JSX: ${message.trim()}`,
        severity: 'error',
        category: 'jsx',
        code: 'REACT_ERROR',
      });
    }
  }

  // ============================================================
  // 13. FALLBACK: If no errors parsed but we have error output,
  //     create a generic error with the raw message
  // ============================================================
  if (errors.length === 0 && (errorOutput.trim() || logs.includes('error'))) {
    // Try to extract any line that looks like an error
    const genericErrorLines = allLogs.split('\n').filter(line => 
      line.toLowerCase().includes('error') ||
      line.includes('×') ||
      line.includes('✕') ||
      line.includes('failed') ||
      line.includes('Failed')
    );

    if (genericErrorLines.length > 0) {
      // Take the first few error-like lines
      const errorContext = genericErrorLines.slice(0, 5).join('\n');
      errors.push({
        message: 'Build error detected',
        severity: 'error',
        category: 'build',
        code: 'UNKNOWN_ERROR',
        context: errorContext,
      });
    } else {
      // Last resort: include raw error
      errors.push({
        message: 'Unknown build error',
        severity: 'error',
        category: 'build',
        code: 'UNKNOWN_ERROR',
        context: errorOutput.substring(0, 1000), // First 1000 chars
      });
    }
  }

  // Calculate flags
  const hasTypeScriptErrors = errors.some(e => e.category === 'typescript');
  const hasESLintErrors = errors.some(e => e.category === 'eslint');
  const hasBuildErrors = errors.some(e => e.category === 'build');
  const hasSyntaxErrors = errors.some(e => e.category === 'syntax' || e.category === 'jsx');
  const hasModuleErrors = errors.some(e => e.category === 'module');

  const summary = generateErrorSummary(errors);

  return {
    errors,
    hasTypeScriptErrors,
    hasESLintErrors,
    hasBuildErrors,
    hasSyntaxErrors,
    hasModuleErrors,
    summary,
    rawError: errorOutput.substring(0, 2000), // Include raw error for debugging
  };
}

/**
 * Generate a human-readable summary of deployment errors
 */
function generateErrorSummary(errors: DeploymentError[]): string {
  if (errors.length === 0) {
    return 'No errors found';
  }

  const typeScriptErrors = errors.filter(e => e.category === 'typescript');
  const eslintErrors = errors.filter(e => e.category === 'eslint');
  const buildErrors = errors.filter(e => e.category === 'build');
  const syntaxErrors = errors.filter(e => e.category === 'syntax');
  const jsxErrors = errors.filter(e => e.category === 'jsx');
  const moduleErrors = errors.filter(e => e.category === 'module');

  const parts: string[] = [];

  if (typeScriptErrors.length > 0) {
    parts.push(`${typeScriptErrors.length} TypeScript error(s)`);
  }
  if (syntaxErrors.length > 0) {
    parts.push(`${syntaxErrors.length} syntax error(s)`);
  }
  if (jsxErrors.length > 0) {
    parts.push(`${jsxErrors.length} JSX error(s)`);
  }
  if (moduleErrors.length > 0) {
    parts.push(`${moduleErrors.length} module error(s)`);
  }
  if (eslintErrors.length > 0) {
    parts.push(`${eslintErrors.length} ESLint error(s)`);
  }
  if (buildErrors.length > 0) {
    parts.push(`${buildErrors.length} build error(s)`);
  }

  return `Deployment failed with ${parts.join(', ')}`;
}

/**
 * Format errors for LLM consumption
 */
export function formatErrorsForLLM(parsed: ParsedDeploymentErrors): string {
  if (parsed.errors.length === 0) {
    // If no parsed errors but we have raw error, include it
    if (parsed.rawError) {
      return `🚨 DEPLOYMENT BUILD ERRORS:\n\nRaw error output:\n${parsed.rawError}`;
    }
    return 'No errors to fix';
  }

  const lines: string[] = [
    '🚨 DEPLOYMENT BUILD ERRORS:',
    '',
    parsed.summary,
    '',
    'ERRORS TO FIX:',
    '',
  ];

  for (const error of parsed.errors) {
    const location = error.file
      ? `${error.file}${error.line ? `:${error.line}` : ''}${error.column ? `:${error.column}` : ''}`
      : 'Unknown location';

    lines.push(`[${error.category.toUpperCase()}] ${location}`);
    lines.push(`  ${error.message}`);
    if (error.context) {
      lines.push(`  Context: ${error.context}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Normalize file path for comparison
 * - Remove leading ./ prefix
 * - Normalize backslashes to forward slashes
 * - Trim whitespace
 */
function normalizePath(p: string): string {
  return p
    .replace(/^\.\//, '')  // Remove leading ./
    .replace(/\\/g, '/')   // Normalize backslashes
    .trim();
}

/**
 * Extract files that need fixing based on errors
 */
export function getFilesToFix(
  parsed: ParsedDeploymentErrors,
  allFiles: { filename: string; content: string }[]
): { filename: string; content: string }[] {
  const filesToFix = new Set<string>();

  // Add files mentioned in errors (normalized)
  for (const error of parsed.errors) {
    if (error.file) {
      filesToFix.add(normalizePath(error.file));
    }
  }

  // If ESLint config errors, include the config file
  if (parsed.hasESLintErrors) {
    filesToFix.add('eslint.config.mjs');
    filesToFix.add('.eslintrc.json');
    filesToFix.add('.eslintrc.js');
  }

  // If module errors, include package.json
  if (parsed.hasModuleErrors) {
    filesToFix.add('package.json');
  }

  // Return the actual file objects using normalized path comparison
  const matchedFiles = allFiles.filter(f => {
    const normalizedFilename = normalizePath(f.filename);
    return [...filesToFix].some(errorFile => 
      normalizedFilename === errorFile ||
      normalizedFilename.endsWith(errorFile) ||
      errorFile.endsWith(normalizedFilename)
    );
  });

  // If no files matched but we have errors, return files that might be related
  // This handles cases where the error file path format is unusual
  if (matchedFiles.length === 0 && parsed.errors.length > 0) {
    // Look for any .tsx/.ts/.jsx/.js files in src/components or src/app
    const likelyFiles = allFiles.filter(f => {
      const name = f.filename.toLowerCase();
      return (name.includes('src/') || name.includes('app/')) &&
             (name.endsWith('.tsx') || name.endsWith('.ts') || name.endsWith('.jsx') || name.endsWith('.js'));
    });
    
    // Return first 5 most likely files
    return likelyFiles.slice(0, 5);
  }

  return matchedFiles;
}
