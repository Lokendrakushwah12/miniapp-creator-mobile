/**
 * Background worker for processing generation jobs
 * This module handles the long-running generation tasks asynchronously
 */

import fs from "fs-extra";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  getGenerationJobById,
  updateGenerationJobStatus,
  createProject,
  saveProjectFiles,
  getUserById,
  getProjectById,
  createDeployment,
  getProjectFiles,
  savePatch,
  updateProject,
  type GenerationJobContext,
} from "./database";
import { executeEnhancedPipeline } from "./enhancedPipeline";
import { executeDiffBasedPipeline } from "./diffBasedPipeline";
import {
  createPreview,
  saveFilesToGenerated,
  getPreviewUrl,
  deployContractsFirst,
  redeployToVercel,
} from "./previewManager";
import { STAGE_MODEL_CONFIG, ANTHROPIC_MODELS } from "./llmOptimizer";
import { updateFilesWithContractAddresses } from "./contractAddressInjector";
import {
  notifyDeploymentComplete,
  notifyDeploymentFailed,
  notifyEditComplete,
} from "./notificationService";
import {
  parseVercelDeploymentErrors,
  formatErrorsForLLM,
  getFilesToFix,
} from "./deploymentErrorParser";
import { logger } from "./logger";


const CUSTOM_DOMAIN_BASE = process.env.CUSTOM_DOMAIN_BASE || 'minidev.fun';

// Maximum consecutive retries with the same error before giving up
const MAX_CONSECUTIVE_SAME_ERROR_RETRIES = 3;

/**
 * Create a normalized error signature for comparison.
 * This helps detect when the same error keeps occurring across retries.
 */
function createErrorSignature(error: string): string {
  // Normalize the error by:
  // 1. Converting to lowercase
  // 2. Removing line numbers (which may vary)
  // 3. Removing file paths (keeping just the filename)
  // 4. Removing whitespace variations
  // 5. Taking the first significant error message
  
  const normalized = error
    .toLowerCase()
    .replace(/\d+:\d+/g, 'LINE:COL') // Normalize line:col references
    .replace(/line \d+/gi, 'line N') // Normalize "line X" references
    .replace(/at line \d+/gi, 'at line N')
    .replace(/\(\d+:\d+\)/g, '(LINE:COL)') // Normalize (line:col)
    .replace(/\/[^\s:]+\//g, '/PATH/') // Normalize directory paths
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  // Extract the first meaningful error message (usually the most important)
  const firstError = normalized.split('\n')[0] || normalized;
  
  // Create a hash-like signature from the first 200 chars
  return firstError.substring(0, 200);
}

/**
 * Check if errors are similar by comparing their signatures
 */
function areErrorsSimilar(error1: string, error2: string): boolean {
  const sig1 = createErrorSignature(error1);
  const sig2 = createErrorSignature(error2);
  
  // Consider errors similar if signatures match or have high overlap
  if (sig1 === sig2) return true;
  
  // Also check for substring match (one error might be more detailed)
  if (sig1.includes(sig2.substring(0, 100)) || sig2.includes(sig1.substring(0, 100))) {
    return true;
  }
  
  return false;
}

// Utility: Recursively read all files in a directory
async function readAllFiles(
  dir: string,
  base = ""
): Promise<{ filename: string; content: string }[]> {
  const files: { filename: string; content: string }[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === ".git" ||
      entry.name === "dist" ||
      entry.name === "build" ||
      entry.name === "pnpm-lock.yaml" ||
      entry.name === "package-lock.json" ||
      entry.name === "yarn.lock" ||
      entry.name === "bun.lockb" ||
      entry.name === "pnpm-workspace.yaml" ||
      entry.name === ".DS_Store" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    const relPath = base ? path.join(base, entry.name) : entry.name;

    if (entry.isDirectory()) {
      files.push(...(await readAllFiles(fullPath, relPath)));
    } else {
      try {
        const content = await fs.readFile(fullPath, "utf8");

        if (content.includes('\0') || content.includes('\x00')) {
          logger.log(`⚠️ Skipping binary file: ${relPath}`);
          continue;
        }

        const sanitizedContent = content
          .replace(/\0/g, '')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        files.push({ filename: relPath, content: sanitizedContent });
      } catch (error) {
        logger.log(`⚠️ Skipping binary file: ${relPath} (${error})`);
        continue;
      }
    }
  }
  return files;
}

// Utility: Write files to disk
async function writeFilesToDir(
  baseDir: string,
  files: { filename: string; content: string }[]
) {
  for (const file of files) {
    const filePath = path.join(baseDir, file.filename);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, file.content, "utf8");
  }
}

// Helper: fetch with retry logic for network errors
async function fetchWithRetry(
  url: string, 
  options: RequestInit = {}, 
  maxRetries = 3,
  baseDelay = 1000
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMessage = lastError.message;
      
      // Check if it's a retryable network error
      const isRetryable = 
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('ENOTFOUND') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('fetch failed') ||
        errorMessage.includes('network') ||
        errorMessage.includes('socket');
      
      if (!isRetryable || attempt === maxRetries) {
        throw lastError;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
      logger.warn(`⚠️ Network error on attempt ${attempt}/${maxRetries}: ${errorMessage}`);
      logger.log(`   Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError || new Error('Fetch failed after all retries');
}

// Fetch boilerplate from GitHub API
async function fetchBoilerplateFromGitHub(targetDir: string, appType: 'farcaster' | 'web3' = 'farcaster') {
  const repoOwner = "Nemil21";
  const repoName = appType === 'web3' ? 'web3-boilerplate' : 'minidev-boilerplate';
  
  // Fetch repository contents recursively
  async function fetchDirectoryContents(dirPath: string = ""): Promise<void> {
    const url = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${dirPath}`;
    
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'minidev-app'
    };
    
    // Add authentication if GitHub token is available
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }
    
    // Use fetchWithRetry instead of plain fetch for resilience
    const response = await fetchWithRetry(url, { headers });
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
    
    const contents = await response.json();
    
    for (const item of contents) {
      const itemPath = dirPath ? path.join(dirPath, item.name) : item.name;
      
      // Skip certain files/directories
      if (
        item.name === "node_modules" ||
        item.name === ".git" ||
        item.name === ".next" ||
        item.name === "dist" ||
        item.name === "build" ||
        item.name === "pnpm-lock.yaml" ||
        item.name === "package-lock.json" ||
        item.name === "yarn.lock" ||
        item.name === "bun.lockb" ||
        item.name === "pnpm-workspace.yaml" ||
        item.name === ".DS_Store" ||
        item.name.startsWith(".")
      ) {
        continue;
      }
      
      if (item.type === "file") {
        // Fetch file content with retry logic
        try {
          const fileResponse = await fetchWithRetry(item.download_url, {});
          if (!fileResponse.ok) {
            logger.warn(`⚠️ Failed to fetch file ${itemPath}: ${fileResponse.status}`);
            continue;
          }
          
          const content = await fileResponse.text();
          
          // Check for binary content
          if (content.includes('\0') || content.includes('\x00')) {
            logger.log(`⚠️ Skipping binary file: ${itemPath}`);
            continue;
          }
          
          // Write file to target directory
          const filePath = path.join(targetDir, itemPath);
          await fs.ensureDir(path.dirname(filePath));
          await fs.writeFile(filePath, content, "utf8");
        } catch (fileError) {
          logger.warn(`⚠️ Failed to fetch file ${itemPath} after retries: ${fileError}`);
          continue;
        }
        
      } else if (item.type === "dir") {
        // Recursively fetch directory contents
        await fetchDirectoryContents(itemPath);
      }
    }
  }
  
  await fetchDirectoryContents();
}

// LLM caller with retry logic
async function callClaudeWithLogging(
  systemPrompt: string,
  userPrompt: string,
  stageName: string,
  stageType?: keyof typeof STAGE_MODEL_CONFIG
): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("Claude API key not set in environment");

  let modelConfig = stageType
    ? STAGE_MODEL_CONFIG[stageType]
    : STAGE_MODEL_CONFIG.LEGACY_SINGLE_STAGE;

  if (stageName.includes('(Retry)') && stageType === 'STAGE_3_CODE_GENERATOR') {
    const increasedTokens = Math.min(modelConfig.maxTokens * 2, 40000);
    modelConfig = {
      ...modelConfig,
      maxTokens: increasedTokens
    } as typeof modelConfig;
  }

  logger.log(`\n🤖 LLM Call - ${stageName}`);
  logger.log("  Model:", modelConfig.model);
  logger.log("  Max Tokens:", modelConfig.maxTokens);

  const body = {
    model: modelConfig.model,
    max_tokens: modelConfig.maxTokens,
    temperature: modelConfig.temperature,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };

  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (attempt > 1) {
      const throttleDelay = Math.min(500 * attempt, 2000);
      logger.log(`⏱️ Throttling request (attempt ${attempt}), waiting ${throttleDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, throttleDelay));
    }

    try {
      const startTime = Date.now();

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 529 || response.status === 429) {
          if (attempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt - 1);

            if (attempt === maxRetries - 1 && modelConfig.fallbackModel) {
              logger.log(`⚠️ API ${response.status} error, switching to fallback model: ${modelConfig.fallbackModel}`);
              body.model = modelConfig.fallbackModel;
            } else {
              logger.log(`⚠️ API ${response.status} error, retrying in ${delay}ms...`);
            }

            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          } else {
            throw new Error(
              `Claude API overloaded after ${maxRetries} attempts. Please try again later.`
            );
          }
        } else if (response.status >= 500) {
          if (attempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt - 1);

            if (attempt === maxRetries - 1 && modelConfig.fallbackModel) {
              logger.log(`⚠️ Server error ${response.status}, switching to fallback model: ${modelConfig.fallbackModel}`);
              body.model = modelConfig.fallbackModel;
            } else {
              logger.log(`⚠️ Server error ${response.status}, retrying in ${delay}ms...`);
            }

            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          } else {
            throw new Error(
              `Claude API server error after ${maxRetries} attempts. Please try again later.`
            );
          }
        } else {
          throw new Error(`Claude API error: ${response.status} ${errorText}`);
        }
      }

      const responseData = await response.json();
      const endTime = Date.now();

      const responseText = responseData.content[0]?.text || "";

      const inputTokens = responseData.usage?.input_tokens || 0;
      const outputTokens = responseData.usage?.output_tokens || 0;
      const totalTokens = inputTokens + outputTokens;

      const actualCost = calculateActualCost(inputTokens, outputTokens, modelConfig.model);

      logger.log("📥 Output:");
      logger.log("  Response Time:", endTime - startTime, "ms");
      logger.log("  Total Tokens:", totalTokens);
      logger.log("  Cost:", actualCost);

      return responseText;
    } catch (error) {
      if (attempt === maxRetries) {
        logger.error(`❌ LLM API Error (${stageName}) after ${maxRetries} attempts:`, error);
        throw error;
      }

      if (
        error instanceof TypeError ||
        (error instanceof Error && error.message.includes("fetch"))
      ) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        logger.log(`⚠️ Network error, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `Failed to get response from Claude API after ${maxRetries} attempts`
  );
}

function calculateActualCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): string {
  let costPer1MInput = 0;
  let costPer1MOutput = 0;

  switch (model) {
    case ANTHROPIC_MODELS.FAST:
      costPer1MInput = 0.25;
      costPer1MOutput = 1.25;
      break;
    case ANTHROPIC_MODELS.BALANCED:
      costPer1MInput = 3;
      costPer1MOutput = 15;
      break;
    case ANTHROPIC_MODELS.POWERFUL:
      costPer1MInput = 15;
      costPer1MOutput = 75;
      break;
  }

  const inputCost = (inputTokens / 1000000) * costPer1MInput;
  const outputCost = (outputTokens / 1000000) * costPer1MOutput;
  const totalCost = inputCost + outputCost;

  return `$${totalCost.toFixed(6)}`;
}

function generateProjectName(intentSpec: { feature: string; reason?: string }): string {
  let projectName = intentSpec.feature;

  projectName = projectName
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = projectName.split(' ').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  );

  projectName = words.join(' ');

  const appTerms = ['app', 'application', 'miniapp', 'mini app', 'dashboard', 'platform', 'tool', 'game', 'player', 'gallery', 'blog', 'store', 'shop'];
  const hasAppTerm = appTerms.some(term => projectName.toLowerCase().includes(term));

  if (!hasAppTerm) {
    projectName += ' App';
  }

  if (projectName.toLowerCase().includes('bootstrap') || projectName.toLowerCase().includes('template')) {
    const now = new Date();
    const timeStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `Miniapp ${timeStr}`;
  }

  return projectName;
}

// Helper function to get project directory path
function getProjectDir(projectId: string): string {
  const outputDir = process.env.NODE_ENV === 'production'
    ? '/tmp/generated'
    : path.join(process.cwd(), 'generated');
  return path.join(outputDir, projectId);
}

// ========================================================================
// LOCAL BUILD VALIDATION LOOP
// ========================================================================

/**
 * Configuration for build validation loop
 */
interface BuildLoopConfig {
  maxIterations: number;
  enableLocalBuildValidation: boolean;
}

const DEFAULT_BUILD_LOOP_CONFIG: BuildLoopConfig = {
  maxIterations: 3,
  enableLocalBuildValidation: true,
};

/**
 * Result of build validation loop
 */
interface BuildValidationResult {
  files: { filename: string; content: string }[];
  buildSuccess: boolean;
  iterations: number;
  errors: string[];
  lastError?: string;
}

/**
 * Validate and fix build errors locally before deployment.
 * This function runs npm run build locally and iterates on fixes
 * until the build passes or max iterations is reached.
 */
async function validateAndFixBuild(
  files: { filename: string; content: string }[],
  projectDir: string,
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>,
  appType: 'farcaster' | 'web3' = 'farcaster',
  config: Partial<BuildLoopConfig> = {}
): Promise<BuildValidationResult> {
  const finalConfig = { ...DEFAULT_BUILD_LOOP_CONFIG, ...config };
  
  logger.log("\n" + "=".repeat(70));
  logger.log("🔨 LOCAL BUILD VALIDATION LOOP");
  logger.log("=".repeat(70));
  logger.log(`📁 Project directory: ${projectDir}`);
  logger.log(`📝 Files to validate: ${files.length}`);
  logger.log(`🔄 Max iterations: ${finalConfig.maxIterations}`);

  if (!finalConfig.enableLocalBuildValidation) {
    logger.log("⏭️ Local build validation disabled, skipping...");
    return {
      files,
      buildSuccess: true, // Assume success if disabled
      iterations: 0,
      errors: [],
    };
  }

  // Import the CompilationValidator
  const { CompilationValidator, CompilationErrorUtils } = await import('./compilationValidator');
  
  let currentFiles = [...files];
  let iteration = 0;
  const allErrors: string[] = [];
  let lastErrorSignature = '';
  let consecutiveSameErrors = 0;

  while (iteration < finalConfig.maxIterations) {
    iteration++;
    logger.log(`\n📦 Build iteration ${iteration}/${finalConfig.maxIterations}`);
    
    // Write current files to project directory
    await writeFilesToDir(projectDir, currentFiles);
    
    // Create validator and run build
    const validator = new CompilationValidator(projectDir, {
      enableTypeScript: true,
      enableBuild: true,
      enableSolidity: currentFiles.some(f => f.filename.endsWith('.sol')),
      enableESLint: false, // Skip ESLint as it's ignored in production builds
      enableRuntimeChecks: true,
      timeoutMs: 120000, // 2 minutes
    });

    logger.log("🔍 Running local build validation...");
    
    const validationResult = await validator.validateProject(
      currentFiles.map(f => ({ filename: f.filename, content: f.content, operation: 'create' })),
      currentFiles
    );

    logger.log(`📊 Build result: ${validationResult.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    logger.log(`   Errors: ${validationResult.errors.length}`);
    logger.log(`   Warnings: ${validationResult.warnings.length}`);

    // If build succeeded, we're done!
    if (validationResult.success) {
      logger.log("🎉 Build passed! Proceeding to deployment...");
      return {
        files: currentFiles,
        buildSuccess: true,
        iterations: iteration,
        errors: allErrors,
      };
    }

    // Check for consecutive same errors (stuck detection)
    const errorSummary = CompilationErrorUtils.getErrorSummary(validationResult.errors);
    const currentErrorSignature = JSON.stringify(errorSummary);
    
    if (currentErrorSignature === lastErrorSignature) {
      consecutiveSameErrors++;
      logger.log(`⚠️ Same errors detected ${consecutiveSameErrors} times in a row`);
      
      if (consecutiveSameErrors >= 2) {
        logger.log("🚫 Stuck on same errors, stopping iteration");
        return {
          files: currentFiles,
          buildSuccess: false,
          iterations: iteration,
          errors: allErrors,
          lastError: validationResult.errors.map(e => `${e.file}:${e.line}: ${e.message}`).join('\n'),
        };
      }
    } else {
      consecutiveSameErrors = 0;
      lastErrorSignature = currentErrorSignature;
    }

    // Collect errors for history
    const errorMessages = validationResult.errors.map(e => 
      `${e.file}:${e.line || '?'}: ${e.message}`
    );
    allErrors.push(...errorMessages);

    // If this is the last iteration, return failure
    if (iteration >= finalConfig.maxIterations) {
      logger.log(`❌ Max iterations (${finalConfig.maxIterations}) reached, stopping`);
      return {
        files: currentFiles,
        buildSuccess: false,
        iterations: iteration,
        errors: allErrors,
        lastError: errorMessages.join('\n'),
      };
    }

    // Format errors for LLM
    logger.log("🤖 Calling LLM to fix build errors...");
    
    const errorsByFile = CompilationErrorUtils.groupErrorsByFile(validationResult.errors);
    const filesToFix: { filename: string; content: string }[] = [];
    const errorDetails: string[] = [];
    
    for (const [filename, errors] of errorsByFile.entries()) {
      const file = currentFiles.find(f => f.filename === filename);
      if (file) {
        filesToFix.push(file);
        
        errorDetails.push(`\n### ${filename}`);
        errorDetails.push(`Errors in this file:`);
        errors.forEach(err => {
          errorDetails.push(`  - Line ${err.line || '?'}: ${err.message}`);
          if (err.suggestion) {
            errorDetails.push(`    💡 Suggestion: ${err.suggestion}`);
          }
        });
        
        // Add file content with error lines marked
        errorDetails.push(`\nFile content (errors marked with >>>):`);
        const lines = file.content.split('\n');
        const errorLines = new Set(errors.map(e => (e.line || 1) - 1));
        lines.forEach((line, idx) => {
          const marker = errorLines.has(idx) ? '>>> ' : '    ';
          errorDetails.push(`${marker}${idx + 1}: ${line}`);
        });
      }
    }

    if (filesToFix.length === 0) {
      logger.log("⚠️ No files identified for fixing, returning current state");
      return {
        files: currentFiles,
        buildSuccess: false,
        iterations: iteration,
        errors: allErrors,
        lastError: errorMessages.join('\n'),
      };
    }

    // Import getStage4ValidatorPrompt
    const { getStage4ValidatorPrompt } = await import('./llmOptimizer');
    
    // Create fix prompt
    const fixPrompt = getStage4ValidatorPrompt(
      filesToFix,
      [errorDetails.join('\n')],
      false, // Use diff-based fixes
      appType
    );

    const fixResponse = await callLLM(
      fixPrompt,
      "",
      `Build Fix Iteration ${iteration}`,
      "STAGE_4_VALIDATOR"
    );

    logger.log(`📥 Received LLM fix response (${fixResponse.length} chars)`);

    // Parse and apply fixes
    const { parseStage4ValidatorResponse } = await import('./parserUtils');
    const { applyDiffsToFiles } = await import('./diffBasedPipeline');
    
    try {
      const fixes = parseStage4ValidatorResponse(fixResponse);
      logger.log(`✅ Parsed ${fixes.length} fixes from LLM`);

      // Convert to FileDiff format
      const fileDiffs = fixes
        .filter(f => f.unifiedDiff && f.diffHunks)
        .map(f => ({
          filename: f.filename,
          hunks: f.diffHunks!,
          unifiedDiff: f.unifiedDiff!,
        }));

      if (fileDiffs.length > 0) {
        // Apply diff-based fixes
        logger.log(`🔧 Applying ${fileDiffs.length} diff-based fixes...`);
        currentFiles = applyDiffsToFiles(currentFiles, fileDiffs);
      } else {
        // Fallback: Check for full content fixes
        const fullContentFixes = fixes.filter(f => f.content && !f.unifiedDiff);
        if (fullContentFixes.length > 0) {
          logger.log(`📝 Applying ${fullContentFixes.length} full-content fixes...`);
          currentFiles = currentFiles.map(currentFile => {
            const fix = fullContentFixes.find(f => f.filename === currentFile.filename);
            return fix ? { ...currentFile, content: fix.content! } : currentFile;
          });
        } else {
          logger.log("⚠️ No applicable fixes found in LLM response");
        }
      }

      logger.log(`✅ Fixes applied, continuing to next iteration...`);
    } catch (parseError) {
      logger.error("❌ Failed to parse LLM fix response:", parseError);
      // Continue to next iteration anyway
    }
  }

  // Should not reach here, but just in case
  return {
    files: currentFiles,
    buildSuccess: false,
    iterations: iteration,
    errors: allErrors,
    lastError: "Max iterations reached",
  };
}

/**
 * Fix deployment errors by parsing Vercel build logs and calling LLM to fix issues
 */
async function fixDeploymentErrors(
  deploymentError: string,
  deploymentLogs: string,
  currentFiles: { filename: string; content: string }[],
  projectId: string,
  appType: 'farcaster' | 'web3' = 'farcaster'
): Promise<{ filename: string; content: string }[]> {
  logger.log("\n" + "=".repeat(70));
  logger.log("🔧 DEPLOYMENT ERROR DETECTED - ATTEMPTING TO FIX");
  logger.log("=".repeat(70));
  logger.log(`🔍 [FIX-DEBUG] Input parameters:`);
  logger.log(`🔍 [FIX-DEBUG] - deploymentError length: ${deploymentError.length}`);
  logger.log(`🔍 [FIX-DEBUG] - deploymentLogs length: ${deploymentLogs.length}`);
  logger.log(`🔍 [FIX-DEBUG] - currentFiles count: ${currentFiles.length}`);
  logger.log(`🔍 [FIX-DEBUG] - projectId: ${projectId}`);
  logger.log(`🔍 [FIX-DEBUG] First 500 chars of error:\n${deploymentError.substring(0, 500)}`);

  // Parse deployment errors
  const parsed = parseVercelDeploymentErrors(deploymentError, deploymentLogs);
  logger.log(`📊 Parsed errors: ${parsed.errors.length} total`);
  logger.log(`   - TypeScript: ${parsed.hasTypeScriptErrors ? 'YES' : 'NO'}`);
  logger.log(`   - ESLint: ${parsed.hasESLintErrors ? 'YES' : 'NO'}`);
  logger.log(`   - Build: ${parsed.hasBuildErrors ? 'YES' : 'NO'}`);
  logger.log(`🔍 [FIX-DEBUG] Parsed error details:`, JSON.stringify(parsed.errors.slice(0, 3), null, 2));

  if (parsed.errors.length === 0) {
    logger.log("⚠️ No parseable errors found in deployment logs");
    logger.log(`🔍 [FIX-DEBUG] Returning ${currentFiles.length} original files unchanged`);
    return currentFiles;
  }

  // Get files that need fixing
  const filesToFix = getFilesToFix(parsed, currentFiles);
  logger.log(`📝 Files to fix: ${filesToFix.length}`);
  filesToFix.forEach(f => logger.log(`   - ${f.filename}`));

  if (filesToFix.length === 0) {
    logger.log("⚠️ No files identified for fixing");
    return currentFiles;
  }

  // Format errors for LLM
  const errorMessage = formatErrorsForLLM(parsed);
  logger.log("\n📋 Error summary for LLM:");
  logger.log(errorMessage);

  // Import getStage4ValidatorPrompt from llmOptimizer
  const { getStage4ValidatorPrompt } = await import('./llmOptimizer');
  
  // Create LLM prompt to fix errors
  const fixPrompt = getStage4ValidatorPrompt(
    filesToFix,
    [errorMessage],
    false, // Use diff-based fixes, not complete file rewrites
    appType // Pass app type for correct context
  );

  logger.log(`\n🤖 Calling LLM to fix deployment errors...`);
  logger.log(`🔍 [FIX-DEBUG] LLM prompt length: ${fixPrompt.length} chars`);
  logger.log(`🔍 [FIX-DEBUG] Using diff-based fixes: true`);
  
  const fixResponse = await callClaudeWithLogging(
    fixPrompt,
    "",
    "Stage 4: Deployment Error Fixes",
    "STAGE_4_VALIDATOR"
  );

  logger.log(`🔍 [FIX-DEBUG] LLM response received, length: ${fixResponse.length} chars`);
  logger.log(`🔍 [FIX-DEBUG] Response preview (first 500 chars):\n${fixResponse.substring(0, 500)}`);

  // Log the response for debugging
  logger.log(`📊 [${projectId}] Stage 4 Deployment Error Fixes:`, {
    errorCount: parsed.errors.length,
    filesToFix: filesToFix.length,
    responseLength: fixResponse.length,
  });
  logger.log(`🔍 [FIX-DEBUG] Response logged to stage4-deployment-error-fixes`);

  // Parse LLM response
  const { parseStage4ValidatorResponse } = await import('./parserUtils');
  const { applyDiffsToFiles } = await import('./diffBasedPipeline');
  
  try {
    const fixes = parseStage4ValidatorResponse(fixResponse);
    logger.log(`✅ Parsed ${fixes.length} fixes from LLM`);
    
    // Log what we got from the LLM
    fixes.forEach((fix, idx) => {
      logger.log(`\n📄 Fix ${idx + 1}: ${fix.filename}`);
      logger.log(`   - Has unifiedDiff: ${!!fix.unifiedDiff}`);
      logger.log(`   - Has diffHunks: ${!!fix.diffHunks}`);
      logger.log(`   - Has content: ${!!fix.content}`);
      if (fix.unifiedDiff) {
        logger.log(`   - Diff length: ${fix.unifiedDiff.length} chars`);
        logger.log(`   - Diff preview: ${fix.unifiedDiff.substring(0, 200)}...`);
      }
      if (fix.diffHunks) {
        logger.log(`   - Number of hunks: ${fix.diffHunks.length}`);
      }
    });

    // Convert to FileDiff format (diffHunks -> hunks)
    const fileDiffs = fixes
      .filter(f => f.unifiedDiff && f.diffHunks)
      .map(f => ({
        filename: f.filename,
        hunks: f.diffHunks!,
        unifiedDiff: f.unifiedDiff!,
      }));

    logger.log(`\n🔍 Filtered to ${fileDiffs.length} files with valid diffs (from ${fixes.length} total)`);

    if (fileDiffs.length === 0) {
      logger.log("⚠️ No diff-based fixes found, returning original files");
      logger.log("💡 LLM may have returned full file content instead of diffs");
      
      // Fallback: If LLM returned full content instead of diffs, use that
      const fullContentFixes = fixes.filter(f => f.content && !f.unifiedDiff);
      if (fullContentFixes.length > 0) {
        logger.log(`📝 Found ${fullContentFixes.length} full-content fixes, applying those instead`);
        const updatedFiles = currentFiles.map(currentFile => {
          const fix = fullContentFixes.find(f => f.filename === currentFile.filename);
          return fix ? { ...currentFile, content: fix.content! } : currentFile;
        });
        return updatedFiles;
      }
      
      return currentFiles;
    }

    // Apply fixes to current files
    logger.log(`\n🔧 Applying diffs to files...`);
    const fixedFiles = applyDiffsToFiles(currentFiles, fileDiffs);
    logger.log(`✅ Applied fixes to ${fixedFiles.length} files`);

    return fixedFiles;
  } catch (parseError) {
    logger.error("❌ Failed to parse LLM fix response:", parseError);
    logger.error("Stack trace:", parseError instanceof Error ? parseError.stack : 'No stack trace');
    logger.log("📋 Returning original files");
    return currentFiles;
  }
}

/**
 * Main worker function to execute a generation job
 */
export async function executeGenerationJob(jobId: string): Promise<void> {
  logger.log(`🚀 Starting job execution: ${jobId}`);

  try {
    // Fetch job from database
    const job = await getGenerationJobById(jobId);

    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== "processing" && job.status !== "pending") {
      throw new Error(`Job ${jobId} is in ${job.status} state, cannot process`);
    }

    // Mark as processing if it's still pending
    if (job.status === "pending") {
      await updateGenerationJobStatus(jobId, "processing");
    }

    // Extract context from job
    const context = job.context as GenerationJobContext;

    // Route to appropriate handler based on job type
    if (context.isFollowUp) {
      logger.log(`🔄 Detected follow-up job, routing to follow-up handler`);
      return await executeFollowUpJob(jobId, job, context);
    } else {
      logger.log(`🆕 Detected initial generation job, routing to initial generation handler`);
      return await executeInitialGenerationJob(jobId, job, context);
    }
  } catch (error) {
    logger.error(`❌ Job ${jobId} failed:`, error);

    // Update job status to failed
    await updateGenerationJobStatus(
      jobId,
      "failed",
      undefined,
      error instanceof Error ? error.message : String(error)
    );

    throw error;
  }
}

/**
 * Execute initial generation job (new project)
 */
async function executeInitialGenerationJob(
  jobId: string,
  job: Awaited<ReturnType<typeof getGenerationJobById>>,
  context: GenerationJobContext
): Promise<void> {
  const { prompt, existingProjectId } = context;
    const accessToken = process.env.PREVIEW_AUTH_TOKEN;

    if (!accessToken) {
      throw new Error("Missing preview auth token");
    }

    // Get user
    const user = await getUserById(job.userId);
    if (!user) {
      throw new Error(`User ${job.userId} not found`);
    }

    logger.log(`🔧 Processing job for user: ${user.displayName || user.username || user.id}`);
    logger.log(`📋 Prompt: ${prompt.substring(0, 100)}...`);
    logger.log(`💬 Conversation History in context: ${context.conversationHistory?.length || 0} messages`);

    // Extract user request
    const lines = prompt.split("\n");
    let userRequest = prompt;

    if (prompt.includes("BUILD THIS MINIAPP:")) {
      const buildMatch = prompt.match(/BUILD THIS MINIAPP:\s*(.+?)(?:\n|$)/);
      if (buildMatch) {
        userRequest = buildMatch[1].trim();
      }
    } else {
      const userMatch = lines.find((line: string) =>
        line.startsWith("User wants to create:")
      );
      if (userMatch) {
        userRequest = userMatch;
      }
    }

    // Use existing project ID or generate new one
    const projectId = existingProjectId || uuidv4();

    logger.log(`📁 Project ID: ${projectId}`);

    // Set up directories
    const outputDir = process.env.NODE_ENV === 'production'
      ? '/tmp/generated'
      : path.join(process.cwd(), 'generated');
    const userDir = path.join(outputDir, projectId);
    const boilerplateDir = path.join(outputDir, `${projectId}-boilerplate`);

    fs.mkdirSync(outputDir, { recursive: true });

    // Get app type from job (defaults to 'farcaster' for backward compatibility)
    const appType = (job.appType as 'farcaster' | 'web3') || 'farcaster';
    const boilerplateName = appType === 'web3' ? 'web3-boilerplate' : 'minidev-boilerplate';
    logger.log(`🎯 Using ${boilerplateName} for ${appType} app`);

    // Use local boilerplate in development, GitHub API in production
    if (process.env.NODE_ENV === 'production') {
      logger.log(`📋 Fetching ${boilerplateName} from GitHub API (production mode)...`);
      try {
        await fetchBoilerplateFromGitHub(boilerplateDir, appType);
        logger.log("✅ Boilerplate fetched successfully");
      } catch (error) {
        logger.error("❌ Failed to fetch boilerplate:", error);
        throw new Error(`Failed to fetch boilerplate: ${error}`);
      }
    } else {
      // Development mode: use local boilerplate
      logger.log(`📋 Copying from local ${boilerplateName} folder (development mode)...`);
      const localBoilerplatePath = path.join(process.cwd(), '..', boilerplateName);
      try {
        await fs.copy(localBoilerplatePath, boilerplateDir);
        logger.log(`✅ Boilerplate copied successfully from local ${boilerplateName}`);
      } catch (error) {
        logger.error(`❌ Failed to copy local ${boilerplateName}:`, error);
        throw new Error(`Failed to copy boilerplate: ${error}`);
      }
    }

    // Copy boilerplate to user directory
    logger.log("📋 Copying boilerplate to user directory...");
    await fs.copy(boilerplateDir, userDir, {
      filter: (src) => {
        const excludePatterns = [
          "node_modules",
          ".git",
          ".next",
          "pnpm-lock.yaml",
          "package-lock.json",
          "yarn.lock",
          "bun.lockb",
          "pnpm-workspace.yaml",
        ];
        return !excludePatterns.some((pattern) => src.includes(pattern));
      },
    });
    logger.log("✅ Boilerplate copied successfully");

    // Clean up boilerplate directory
    await fs.remove(boilerplateDir);

    // Read boilerplate files
    logger.log("📖 Reading boilerplate files...");
    const boilerplateFiles = await readAllFiles(userDir);
    logger.log(`📁 Found ${boilerplateFiles.length} boilerplate files`);

    // Create LLM caller
    const callLLM = async (
      systemPrompt: string,
      userPrompt: string,
      stageName: string,
      stageType?: keyof typeof STAGE_MODEL_CONFIG
    ): Promise<string> => {
      return callClaudeWithLogging(
        systemPrompt,
        userPrompt,
        stageName,
        stageType
      );
    };

    // Execute enhanced pipeline
    logger.log("🔄 Executing enhanced pipeline...");
    const enhancedResult = await executeEnhancedPipeline(
      prompt,
      boilerplateFiles,
      projectId,
      accessToken,
      callLLM,
      appType, // Pass app type for correct LLM context
      true, // isInitialGeneration
      userDir
    );

    if (!enhancedResult.success) {
      throw new Error(enhancedResult.error || "Enhanced pipeline failed");
    }

    let generatedFiles = enhancedResult.files.map(f => ({
      filename: f.filename,
      content: f.content
    }));

    logger.log(`✅ Successfully generated ${generatedFiles.length} files`);

    // Filter out contracts for non-Web3 apps BEFORE writing to disk
    if (enhancedResult.intentSpec && !enhancedResult.intentSpec.isWeb3) {
      const originalCount = generatedFiles.length;
      generatedFiles = generatedFiles.filter(file => {
        const isContractFile = file.filename.startsWith('contracts/');
        if (isContractFile) {
          logger.log(`🗑️ Filtering out contract file: ${file.filename}`);
        }
        return !isContractFile;
      });
      logger.log(`📦 Filtered ${originalCount - generatedFiles.length} contract files from generated output`);

      // Also delete contracts directory from disk if it exists
      const contractsDir = path.join(userDir, 'contracts');
      if (await fs.pathExists(contractsDir)) {
        logger.log("🗑️ Removing contracts/ directory from disk...");
        await fs.remove(contractsDir);
        logger.log("✅ Contracts directory removed from disk");
      }
    }

    // Write files to disk (now without contracts for non-Web3 apps)
    logger.log("💾 Writing generated files to disk...");
    await writeFilesToDir(userDir, generatedFiles);
    await saveFilesToGenerated(projectId, generatedFiles);
    logger.log("✅ Files written successfully");

    // NEW: Deploy contracts FIRST for Web3 projects (before creating preview)
    let contractAddresses: { [key: string]: string } | undefined;

    if (enhancedResult.intentSpec?.isWeb3) {
      logger.log("\n" + "=".repeat(70));
      logger.log("🔗 WEB3 PROJECT DETECTED - DEPLOYING CONTRACTS FIRST");
      logger.log("=".repeat(70) + "\n");

      try {
        // Filter out hardhat.config files to use boilerplate's configuration
        // The boilerplate's hardhat.config.js has proper Base network configuration
        const contractFiles = generatedFiles.filter(file => {
          const isHardhatConfig = file.filename === 'hardhat.config.js' || 
                                  file.filename === 'hardhat.config.ts' ||
                                  file.filename === 'contracts/hardhat.config.js' ||
                                  file.filename === 'contracts/hardhat.config.ts';
          if (isHardhatConfig) {
            logger.log(`🛡️ Filtering out ${file.filename} to use boilerplate's hardhat config`);
          }
          return !isHardhatConfig;
        });
        
        logger.log(`📤 Deploying contracts with ${contractFiles.length} files (filtered out hardhat configs)`);
        
        // Deploy contracts and get real addresses
        contractAddresses = await deployContractsFirst(
          projectId,
          contractFiles,
          accessToken
        );

        logger.log("✅ Contracts deployed successfully!");
        logger.log("📝 Contract addresses:", JSON.stringify(contractAddresses, null, 2));

        // Inject real contract addresses into files BEFORE deployment
        if (contractAddresses && Object.keys(contractAddresses).length > 0) {
          logger.log("\n" + "=".repeat(70));
          logger.log("💉 INJECTING CONTRACT ADDRESSES INTO FILES");
          logger.log("=".repeat(70) + "\n");

          generatedFiles = updateFilesWithContractAddresses(
            generatedFiles,
            contractAddresses
          );

          // Rewrite files with injected addresses
          await writeFilesToDir(userDir, generatedFiles);
          await saveFilesToGenerated(projectId, generatedFiles);
          logger.log("✅ Contract addresses injected and files updated");
        }
      } catch (contractError) {
        logger.error("\n" + "=".repeat(70));
        logger.error("⚠️  CONTRACT DEPLOYMENT FAILED - CONTINUING WITH PLACEHOLDERS");
        logger.error("=".repeat(70));
        logger.error("Error:", contractError);
        logger.log("📝 App will deploy with placeholder addresses\n");
        // Continue with placeholder addresses - don't fail the entire job
      }
    }

    // LOCAL BUILD VALIDATION: Run npm run build locally before deploying to Vercel
    // This catches errors early and fixes them before wasting Vercel deployment time
    logger.log("\n" + "=".repeat(70));
    logger.log("🔨 PRE-DEPLOYMENT: LOCAL BUILD VALIDATION");
    logger.log("=".repeat(70) + "\n");
    
    try {
      const buildValidationResult = await validateAndFixBuild(
        generatedFiles,
        userDir,
        callClaudeWithLogging,
        appType,
        { maxIterations: 3, enableLocalBuildValidation: true }
      );
      
      logger.log(`📊 Local build validation completed:`);
      logger.log(`   - Success: ${buildValidationResult.buildSuccess}`);
      logger.log(`   - Iterations: ${buildValidationResult.iterations}`);
      logger.log(`   - Errors fixed: ${buildValidationResult.errors.length}`);
      
      if (buildValidationResult.buildSuccess) {
        // Update generatedFiles with the fixed files
        generatedFiles = buildValidationResult.files;
        
        // Save the fixed files to disk and generated directory
        await writeFilesToDir(userDir, generatedFiles);
        await saveFilesToGenerated(projectId, generatedFiles);
        logger.log("✅ Local build passed! Proceeding to Vercel deployment...");
      } else {
        logger.warn("⚠️ Local build failed after max iterations, proceeding anyway...");
        logger.log(`   Last error: ${buildValidationResult.lastError?.substring(0, 200) || 'Unknown'}...`);
        // Still use the latest files from the build loop (they may be partially fixed)
        generatedFiles = buildValidationResult.files;
        await writeFilesToDir(userDir, generatedFiles);
        await saveFilesToGenerated(projectId, generatedFiles);
      }
    } catch (buildError) {
      logger.error("❌ Local build validation failed with exception:", buildError);
      logger.log("⚠️ Continuing to Vercel deployment anyway...");
      // Continue with existing files - Vercel deployment will catch any remaining errors
    }

    // Create preview (now with real contract addresses injected if Web3)
    logger.log("\n🚀 Creating Vercel preview...");
    let previewData: Awaited<ReturnType<typeof createPreview>> | undefined;
    let projectUrl: string = `https://${projectId}.${CUSTOM_DOMAIN_BASE}`; // Default fallback URL (custom domain)
    const maxDeploymentRetries = 4; // Allow up to 3 retries with fixes (to detect 3 consecutive same errors)
    let deploymentAttempt = 0;
    
    // Track consecutive errors to detect when we're stuck on the same error
    const errorHistory: string[] = [];
    let consecutiveSameErrorCount = 0;
    let stuckOnError = false;

    while (deploymentAttempt < maxDeploymentRetries) {
      deploymentAttempt++;
      logger.log(`\n📦 Deployment attempt ${deploymentAttempt}/${maxDeploymentRetries}...`);
      logger.log(`🔍 [RETRY-DEBUG] Starting deployment attempt ${deploymentAttempt}`);
      logger.log(`🔍 [RETRY-DEBUG] maxDeploymentRetries: ${maxDeploymentRetries}`);
      logger.log(`🔍 [RETRY-DEBUG] Files count: ${generatedFiles.length}`);
      logger.log(`🔍 [RETRY-DEBUG] Error history count: ${errorHistory.length}`);
      logger.log(`🔍 [RETRY-DEBUG] Consecutive same error count: ${consecutiveSameErrorCount}`);

      try {
        // Skip contract deployment in /deploy endpoint if we already deployed them
        const skipContractsInDeploy = !!contractAddresses; // true if we already deployed contracts
        logger.log(`🔍 [RETRY-DEBUG] skipContractsInDeploy: ${skipContractsInDeploy}`);
        
        // CRITICAL LOGGING: Track appType and isWeb3 before deployment
        logger.log(`\n${'='.repeat(70)}`);
        logger.log(`🎯 DEPLOYMENT PARAMETERS`);
        logger.log(`${'='.repeat(70)}`);
        logger.log(`📦 appType (user-selected boilerplate): "${appType}"`);
        logger.log(`🔗 isWeb3 (LLM-detected contracts): ${enhancedResult.intentSpec?.isWeb3}`);
        logger.log(`⏭️  skipContractsInDeploy: ${skipContractsInDeploy}`);
        logger.log(`${'='.repeat(70)}\n`);

        previewData = await createPreview(
          projectId,
          generatedFiles, // Already contains real addresses if Web3
          accessToken,
          appType, // Use user-selected app type for boilerplate selection
          enhancedResult.intentSpec?.isWeb3, // Whether to deploy contracts (LLM's analysis)
          skipContractsInDeploy, // Skip contracts if we already deployed them
          jobId // Pass jobId for background deployment error reporting
        );

        logger.log(`🔍 [RETRY-DEBUG] Preview data received:`, {
          status: previewData.status,
          hasError: !!previewData.deploymentError,
          hasLogs: !!previewData.deploymentLogs,
          errorLength: previewData.deploymentError?.length || 0,
          logsLength: previewData.deploymentLogs?.length || 0
        });

        // Check if deployment failed with errors
        if (previewData.status === 'deployment_failed' && previewData.deploymentError) {
          logger.error(`❌ Deployment failed on attempt ${deploymentAttempt}`);
          logger.log(`📋 Deployment error: ${previewData.deploymentError}`);
          logger.log(`📋 Deployment logs available: ${previewData.deploymentLogs ? 'YES' : 'NO'}`);
          logger.log(`🔍 [RETRY-DEBUG] Deployment failed, checking if retry is possible...`);
          logger.log(`🔍 [RETRY-DEBUG] deploymentAttempt < maxDeploymentRetries: ${deploymentAttempt < maxDeploymentRetries}`);
          
          // Track consecutive same errors
          const currentErrorSignature = createErrorSignature(previewData.deploymentError);
          if (errorHistory.length > 0) {
            const lastError = errorHistory[errorHistory.length - 1];
            if (areErrorsSimilar(previewData.deploymentError, lastError)) {
              consecutiveSameErrorCount++;
              logger.log(`🔄 [STUCK-CHECK] Same error detected! Consecutive count: ${consecutiveSameErrorCount}`);
            } else {
              consecutiveSameErrorCount = 1; // Reset counter for new error
              logger.log(`🔄 [STUCK-CHECK] Different error detected, resetting counter`);
            }
          } else {
            consecutiveSameErrorCount = 1;
          }
          errorHistory.push(previewData.deploymentError);
          logger.log(`🔍 [STUCK-CHECK] Error signature: ${currentErrorSignature.substring(0, 100)}...`);
          
          // Check if we're stuck on the same error
          if (consecutiveSameErrorCount >= MAX_CONSECUTIVE_SAME_ERROR_RETRIES) {
            logger.error(`🚫 [STUCK-CHECK] Stuck on same error after ${consecutiveSameErrorCount} consecutive retries!`);
            stuckOnError = true;
            
            // Mark job as failed with stuck_on_error status
            const errorDetails = {
              status: 'stuck_on_error',
              stuckOnError: true,
              consecutiveRetries: consecutiveSameErrorCount,
              attempts: deploymentAttempt,
              deploymentError: previewData.deploymentError,
              deploymentLogs: previewData.deploymentLogs ? previewData.deploymentLogs.substring(0, 1000) : undefined,
              projectId: projectId,
              generatedFiles: generatedFiles.map(f => f.filename),
              url: `https://${projectId}.${CUSTOM_DOMAIN_BASE}`,
              port: 3000,
            };
            
            await updateGenerationJobStatus(jobId, 'failed', errorDetails, 
              `Stuck on same error after ${consecutiveSameErrorCount} consecutive retries. Please try building the app again with a fresh start.`);
            
            previewData = undefined;
            break; // Exit the retry loop
          }
          
          // Log to database for visibility
          await updateGenerationJobStatus(jobId, 'processing', {
            status: 'deployment_retry',
            attempt: deploymentAttempt,
            maxAttempts: maxDeploymentRetries,
            consecutiveSameErrorCount,
            error: previewData.deploymentError.substring(0, 500), // Truncate for DB
            hasLogs: !!previewData.deploymentLogs
          });
          logger.log(`🔍 [RETRY-DEBUG] Database status updated with deployment_retry`);
          
          // If this is not the last attempt, try to fix errors
          if (deploymentAttempt < maxDeploymentRetries) {
            logger.log(`🔧 Attempting to fix deployment errors...`);
            logger.log(`🔍 [RETRY-DEBUG] Calling fixDeploymentErrors with:`);
            logger.log(`🔍 [RETRY-DEBUG] - Error length: ${previewData.deploymentError.length}`);
            logger.log(`🔍 [RETRY-DEBUG] - Logs length: ${previewData.deploymentLogs?.length || 0}`);
            logger.log(`🔍 [RETRY-DEBUG] - Files count: ${generatedFiles.length}`);
            logger.log(`🔍 [RETRY-DEBUG] - Project ID: ${projectId}`);
            
            const fixedFiles = await fixDeploymentErrors(
              previewData.deploymentError,
              previewData.deploymentLogs || '', // Use empty string if logs not available
              generatedFiles,
              projectId,
              (job.appType as 'farcaster' | 'web3') || 'farcaster' // Pass app type for correct LLM context
            );

            logger.log(`🔍 [RETRY-DEBUG] fixDeploymentErrors returned ${fixedFiles.length} files`);
            logger.log(`🔍 [RETRY-DEBUG] Files changed: ${fixedFiles.length !== generatedFiles.length ? 'YES (count changed)' : 'checking content...'}`);

            // Update generatedFiles with fixes
            generatedFiles = fixedFiles;

            // Write fixed files back to disk
            logger.log(`🔍 [RETRY-DEBUG] Writing ${fixedFiles.length} fixed files to disk...`);
            await writeFilesToDir(userDir, generatedFiles);
            await saveFilesToGenerated(projectId, generatedFiles);
            logger.log("✅ Fixed files saved, retrying deployment...");
            
            // Log retry to database
            await updateGenerationJobStatus(jobId, 'processing', {
              status: 'deployment_retrying',
              attempt: deploymentAttempt + 1,
              maxAttempts: maxDeploymentRetries,
              consecutiveSameErrorCount,
              fixesApplied: true
            });
            logger.log(`🔍 [RETRY-DEBUG] Database updated with deployment_retrying status`);
            logger.log(`🔍 [RETRY-DEBUG] Continuing to next deployment attempt...`);
            
            // Continue to next iteration to retry deployment
            continue;
          } else {
            // Last attempt failed, mark job as failed
            // DON'T throw here - we're inside a try block and it will be caught
            // Instead, we'll break out of the loop and handle failure after
            logger.error("❌ All deployment attempts failed - breaking out of retry loop");
            
            // IMPORTANT: Include projectId and generatedFiles in error result
            // so frontend can still display the saved files
            const errorDetails = {
              status: 'deployment_failed_all_attempts',
              stuckOnError: stuckOnError,
              consecutiveRetries: consecutiveSameErrorCount,
              attempts: deploymentAttempt,
              deploymentError: previewData.deploymentError,
              deploymentLogs: previewData.deploymentLogs ? previewData.deploymentLogs.substring(0, 1000) : undefined,
              // Include project data so files can be viewed despite deployment failure
              projectId: projectId,
              generatedFiles: generatedFiles.map(f => f.filename),
              url: `https://${projectId}.${CUSTOM_DOMAIN_BASE}`,
              port: 3000,
            };
            
            await updateGenerationJobStatus(jobId, 'failed', errorDetails, previewData.deploymentError);
            
            // Set previewData to undefined to indicate failure
            previewData = undefined;
            break; // Exit the retry loop
          }
        }

        // Deployment succeeded
        logger.log("✅ Preview created successfully");
        // Use Vercel URL if available, otherwise fall back to preview URL
        projectUrl = previewData.vercelUrl || previewData.previewUrl || getPreviewUrl(projectId) || `https://${projectId}.${CUSTOM_DOMAIN_BASE}`;
        logger.log(`🎉 Project ready at: ${projectUrl}`);
        logger.log(`🌐 Vercel URL: ${previewData.vercelUrl || 'Not available'}`);
        break; // Exit retry loop on success

      } catch (previewError) {
        logger.error(`❌ Failed to create preview on attempt ${deploymentAttempt}:`, previewError);
        
        // Check if it's a timeout error that should trigger retry
        const errorMessage = previewError instanceof Error ? previewError.message : String(previewError);
        const isTimeoutError = errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ECONNRESET');
        
        logger.log(`🔍 [RETRY-DEBUG] Error type: ${isTimeoutError ? 'TIMEOUT' : 'OTHER'}`);
        logger.log(`🔍 [RETRY-DEBUG] Error message: ${errorMessage}`);
        logger.log(`🔍 [RETRY-DEBUG] Should retry: ${isTimeoutError && deploymentAttempt < maxDeploymentRetries}`);
        
        // Convert timeout errors to deployment_failed status so retry logic can handle them
        if (isTimeoutError && deploymentAttempt < maxDeploymentRetries) {
          logger.log(`⏱️ Timeout detected, treating as deployment failure and retrying...`);
          
          // Log to database
          await updateGenerationJobStatus(jobId, 'processing', {
            status: 'deployment_timeout',
            attempt: deploymentAttempt,
            maxAttempts: maxDeploymentRetries,
            error: errorMessage
          });
          
          // For timeout errors, just retry without trying to fix
          logger.log(`🔄 Retrying deployment after timeout...`);
          continue;
        } else if (deploymentAttempt >= maxDeploymentRetries) {
          // If this is the last attempt, fail the job
          logger.error("❌ All deployment attempts failed after exception");
          
          // IMPORTANT: Include projectId and generatedFiles in error result
          // so frontend can still display the saved files
          const errorDetails = {
            status: 'deployment_failed_exception',
            attempts: deploymentAttempt,
            errorType: isTimeoutError ? 'timeout' : 'other',
            deploymentError: errorMessage,
            // Include project data so files can be viewed despite deployment failure
            projectId: projectId,
            generatedFiles: generatedFiles.map(f => f.filename),
            url: `https://${projectId}.${CUSTOM_DOMAIN_BASE}`,
            port: 3000,
          };
          
          await updateGenerationJobStatus(jobId, 'failed', errorDetails, errorMessage);
          
          // Throw error to stop job execution
          throw new Error(`Deployment failed after ${deploymentAttempt} attempts: ${errorMessage}`);
        } else {
          // Non-timeout error on non-final attempt - retry
          logger.log(`🔧 Non-timeout error, retrying...`);
          continue;
        }
      }
    }

    // Track if deployment failed
    const deploymentFailed = !previewData || previewData.status === 'deployment_failed';
    const deploymentError = previewData?.deploymentError || 'Deployment failed';

    // Save project to database (ALWAYS save, even if deployment failed)
    logger.log("💾 Saving project to database...");

    const projectName = enhancedResult.intentSpec
      ? generateProjectName(enhancedResult.intentSpec)
      : `Project ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

    // Check if project already exists (from a previous attempt)
    let project = await getProjectById(projectId);

    if (!project) {
      // IMPORTANT: Save conversation history BEFORE creating project
      // This ensures messages are available immediately when project loads
      let conversationMessages: Array<{ role: 'user' | 'ai'; content: string; phase?: string }> = [];
      if (context.conversationHistory && context.conversationHistory.length > 0) {
        logger.log(`📝 Preparing ${context.conversationHistory.length} messages for project ${projectId}`);
        conversationMessages = context.conversationHistory.map(msg => ({
          role: msg.role as 'user' | 'ai',
          content: msg.content,
          phase: msg.phase
        }));
      }
      
      // Create new project
      project = await createProject(
        user.id,
        projectName,
        `AI-generated project: ${userRequest.substring(0, 100)}...`,
        projectUrl,
        projectId,
        appType // Pass appType from the generation job
      );
      logger.log(`✅ Project created in database with appType: ${appType}`);
      
      // Save conversation history immediately after project creation
      // This must complete BEFORE we continue to ensure messages are in database
      if (conversationMessages.length > 0) {
        try {
          logger.log(`💾 Saving ${conversationMessages.length} messages to project ${projectId} (BLOCKING)`);
          const { saveChatMessage } = await import('./database');
          
          // Save all messages sequentially to ensure order
          for (const msg of conversationMessages) {
            await saveChatMessage(
              projectId,
              msg.role,
              msg.content,
              msg.phase,
              undefined  // changedFiles not in history
            );
          }
          
          logger.log(`✅ All ${conversationMessages.length} conversation messages saved to database`);
        } catch (error) {
          logger.error('❌ CRITICAL: Failed to save conversation history:', error);
          // This IS critical - messages must be saved
          throw new Error(`Failed to save conversation history: ${error}`);
        }
      } else {
        logger.log(`ℹ️ No conversation history to save`);
      }
    } else {
      logger.log("ℹ️ Project already exists in database, updating files");
    }

    // Save files to database (this will replace existing files)
    const allFilesFromDisk = await readAllFiles(userDir);

    // Filter out contracts/ for non-Web3 apps
    const filesToSave = enhancedResult.intentSpec && !enhancedResult.intentSpec.isWeb3
      ? allFilesFromDisk.filter(file => {
          const isContractFile = file.filename.startsWith('contracts/');
          if (isContractFile) {
            logger.log(`🗑️ Excluding contract file from database: ${file.filename}`);
          }
          return !isContractFile;
        })
      : allFilesFromDisk;

    logger.log(`📦 Files to save: ${filesToSave.length} (excluded ${allFilesFromDisk.length - filesToSave.length} contract files)`);

    // Inject dynamic metadata into layout.tsx with the actual project URL
    const { processFilesWithMetadata } = await import('./metadataInjector');
    const filesWithMetadata = processFilesWithMetadata(
      filesToSave,
      projectName,
      `A Farcaster miniapp: ${userRequest.substring(0, 100)}`,
      projectUrl // Use the actual deployment URL for metadata
    );
    logger.log(`✅ Injected dynamic metadata with project URL: ${projectUrl}`);

    const safeFiles = filesWithMetadata.filter(file => {
      if (file.content.includes('\0') || file.content.includes('\x00')) {
        logger.log(`⚠️ Skipping file with null bytes: ${file.filename}`);
        return false;
      }
      return true;
    });

    await saveProjectFiles(project.id, safeFiles);
    logger.log("✅ Project files saved to database successfully");
    
    // Redeploy to Vercel with updated metadata (so OG tags are correct when shared)
    try {
      logger.log("🔄 Redeploying to Vercel with updated metadata...");
      const { redeployToVercel } = await import('./previewManager');
      const redeployResult = await redeployToVercel(
        projectId,
        filesWithMetadata,
        accessToken,
        appType,
        enhancedResult.intentSpec?.isWeb3 || false,
        jobId
      );
      if (redeployResult.vercelUrl) {
        logger.log(`✅ Vercel redeployment successful with updated metadata: ${redeployResult.vercelUrl}`);
      }
    } catch (redeployError) {
      logger.warn("⚠️ Vercel redeployment failed (metadata may not be updated):", redeployError);
      // Don't fail the job - the initial deployment is still valid
    }

    // If deployment failed, mark job as failed and return early
    if (deploymentFailed) {
      logger.error("❌ Deployment failed - marking job as failed");
      
      // Save deployment info with 'failed' status
      try {
        await createDeployment(
          project.id,
          'vercel',
          projectUrl,
          'failed',
          previewData?.deploymentLogs || deploymentError // Save logs or error
        );
        logger.log("✅ Failed deployment info saved to database");
      } catch (dbError) {
        logger.error("⚠️ Failed to save deployment info:", dbError);
      }

      // Update project with basic info
      try {
        await updateProject(project.id, {
          previewUrl: projectUrl,
          name: projectName,
          description: `${userRequest.substring(0, 100)}...`
        });
      } catch (dbError) {
        logger.error("⚠️ Failed to update project:", dbError);
      }

      // Send notification to user that deployment failed
      try {
        await notifyDeploymentFailed(job!.userId, project.id);
        logger.log(`📬 Deployment failure notification sent to user`);
      } catch (notifyError) {
        logger.warn(`⚠️ Failed to send deployment failure notification:`, notifyError);
      }

      // Job was already marked as 'failed' in the deployment loop
      // Throw error to prevent marking as completed
      throw new Error(`Deployment failed: ${deploymentError}`);
    }

    // Deployment succeeded - save deployment info
    try {
      logger.log("💾 Saving successful deployment info to database...");
      
      const deploymentUrl = previewData?.vercelUrl || projectUrl;
      logger.log(`🌐 Deployment URL to save: ${deploymentUrl}`);

      // Use contract addresses from our deployment (already injected into files)
      // Fall back to previewData.contractAddresses for backward compatibility
      const deploymentContractAddresses = contractAddresses || previewData?.contractAddresses;

      const deployment = await createDeployment(
        project.id, // Use actual project.id from database record
        'vercel',
        deploymentUrl,
        'success',
        undefined, // buildLogs
        deploymentContractAddresses // Contract addresses (real ones from our deployment)
      );
      logger.log(`✅ Deployment saved to database: ${deployment.id}`);

      if (deploymentContractAddresses && Object.keys(deploymentContractAddresses).length > 0) {
        logger.log(`📝 Contract addresses saved:`, JSON.stringify(deploymentContractAddresses, null, 2));
      }

      // CRITICAL: Update the projects table with deployment URL and metadata
      logger.log("🔄 Updating projects table with deployment URL...");
      await updateProject(project.id, {
        previewUrl: deploymentUrl,
        vercelUrl: previewData?.vercelUrl || undefined, // Save Vercel URL separately
        name: projectName,
        description: `${userRequest.substring(0, 100)}...`
      });
      logger.log(`✅ Projects table updated with URL: ${deploymentUrl}`);
    } catch (deploymentDbError) {
      logger.error("⚠️ Failed to save deployment info:", deploymentDbError);
      // Don't fail the entire job if deployment record fails
    }

    // Update job status to completed (only reached if deployment succeeded)
    const result = {
      projectId,
      url: projectUrl,
      port: previewData?.port || 3000,
      success: true,
      generatedFiles: generatedFiles.map((f) => f.filename),
      totalFiles: generatedFiles.length,
      previewUrl: previewData?.previewUrl || projectUrl,
      vercelUrl: previewData?.vercelUrl,
      projectName,
      contractAddresses: contractAddresses, // Include contract addresses in result
      appType, // Include appType so UI knows which boilerplate was used
    };

    logger.log(`📝 Updating job ${jobId} status to completed with result:`, {
      projectId: result.projectId,
      vercelUrl: result.vercelUrl,
      totalFiles: result.totalFiles
    });

    try {
      await updateGenerationJobStatus(jobId, "completed", result);
      logger.log(`✅ Job ${jobId} status updated to completed in database`);
    } catch (updateError) {
      logger.error(`❌ Failed to update job status to completed:`, updateError);
      throw updateError; // Re-throw to trigger error handling
    }

    // Send notification to user that deployment is complete
    try {
      const deploymentUrl = result.vercelUrl || result.previewUrl || projectUrl;
      await notifyDeploymentComplete(job!.userId, project.id, deploymentUrl);
      logger.log(`📬 Deployment notification sent to user`);
    } catch (notifyError) {
      logger.warn(`⚠️ Failed to send deployment notification:`, notifyError);
      // Don't fail the job if notification fails
    }

    logger.log(`✅ Job ${jobId} completed successfully`);
    logger.log(`🎉 Final result:`, {
      projectId: result.projectId,
      vercelUrl: result.vercelUrl,
      previewUrl: result.previewUrl
    });
}

/**
 * Execute follow-up edit job (existing project)
 */
async function executeFollowUpJob(
  jobId: string,
  job: Awaited<ReturnType<typeof getGenerationJobById>>,
  context: GenerationJobContext
): Promise<void> {
  logger.log(`🔄 Starting follow-up job execution: ${jobId}`);

  const { prompt, existingProjectId: projectId, useDiffBased = true } = context;
  const accessToken = process.env.PREVIEW_AUTH_TOKEN;
  const appType = (job.appType as 'farcaster' | 'web3') || 'farcaster';

  if (!accessToken) {
    throw new Error("Missing preview auth token");
  }

  if (!projectId) {
    throw new Error("Follow-up job requires existingProjectId in context");
  }

  // Get user
  const user = await getUserById(job.userId);
  if (!user) {
    throw new Error(`User ${job.userId} not found`);
  }

  logger.log(`🔧 Processing follow-up job for user: ${user.displayName || user.username || user.id}`);
  logger.log(`📋 Prompt: ${prompt.substring(0, 100)}...`);
  logger.log(`📁 Project ID: ${projectId}`);

  // Get project directory
  const userDir = getProjectDir(projectId);
  const outputDir = process.env.NODE_ENV === 'production' ? '/tmp/generated' : path.join(process.cwd(), 'generated');

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Load existing files
  let currentFiles: { filename: string; content: string }[] = [];

  try {
    // Try reading from disk first
    if (await fs.pathExists(userDir)) {
      logger.log(`📁 Reading files from disk: ${userDir}`);
      currentFiles = await readAllFiles(userDir);
    } else {
      logger.log(`💾 Directory not found on disk, fetching from database for project: ${projectId}`);
      // Fetch files from database
      const dbFiles = await getProjectFiles(projectId);
      currentFiles = dbFiles.map(f => ({
        filename: f.filename,
        content: f.content
      }));

      if (currentFiles.length > 0) {
        logger.log(`✅ Loaded ${currentFiles.length} files from database`);
        // Recreate the directory structure on disk for processing
        logger.log(`📁 Recreating project directory: ${userDir}`);
        await writeFilesToDir(userDir, currentFiles);
        logger.log(`✅ Project files restored to disk`);
      }
    }
  } catch (error) {
    logger.error(`❌ Error reading project files:`, error);
    throw new Error(`Failed to load project files: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (currentFiles.length === 0) {
    throw new Error(`No existing files found for project ${projectId}`);
  }

  logger.log("\n[EDIT-WORKER] ========================================");
  logger.log("[EDIT-WORKER] 🚀 STARTING FOLLOW-UP EDIT");
  logger.log("[EDIT-WORKER] ========================================");
  logger.log(`[EDIT-WORKER] Project ID: ${projectId}`);
  logger.log(`[EDIT-WORKER] Input files count: ${currentFiles.length}`);
  logger.log(`[EDIT-WORKER] Input files:`, currentFiles.map(f => f.filename));
  logger.log(`[EDIT-WORKER] Prompt (first 200 chars): ${prompt.substring(0, 200)}`);

  // Create LLM caller
  const callLLM = async (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ): Promise<string> => {
    return callClaudeWithLogging(
      systemPrompt,
      userPrompt,
      stageName,
      stageType
    );
  };

  // Execute appropriate pipeline
  let result;
  if (useDiffBased) {
    logger.log("[EDIT-WORKER] Using diff-based pipeline");
    result = await executeDiffBasedPipeline(
      prompt,
      currentFiles,
      callLLM,
      {
        enableContextGathering: true,
        enableDiffValidation: true,
        enableLinting: true
      },
      projectId,
      userDir
    );
  } else {
    logger.log("[EDIT-WORKER] Using enhanced pipeline");
    result = await executeEnhancedPipeline(
      prompt,
      currentFiles,
      projectId,
      accessToken,
      callLLM,
      appType,
      false,  // isInitialGeneration = false
      userDir
    );
  }

  // Check if result has diffs (from diff-based pipeline)
  const hasDiffs = 'diffs' in result && result.diffs;
  const diffCount = hasDiffs ? (result as { diffs: unknown[] }).diffs.length : 0;
  
  logger.log("\n[EDIT-WORKER] ========================================");
  logger.log("[EDIT-WORKER] PIPELINE RESULT");
  logger.log("[EDIT-WORKER] ========================================");
  logger.log(`[EDIT-WORKER] Output files count: ${result.files.length}`);
  logger.log(`[EDIT-WORKER] Output files:`, result.files.map(f => f.filename));
  logger.log(`[EDIT-WORKER] Diffs count: ${diffCount}`);
  
  // Log which files actually changed
  for (const file of result.files) {
    const original = currentFiles.find(f => f.filename === file.filename);
    if (original) {
      const changed = original.content !== file.content;
      logger.log(`[EDIT-WORKER] File: ${file.filename} - ${changed ? 'CHANGED' : 'UNCHANGED'}`);
      if (changed) {
        logger.log(`[EDIT-WORKER]   Original: ${original.content.length} chars, New: ${file.content.length} chars`);
      }
    } else {
      logger.log(`[EDIT-WORKER] File: ${file.filename} - NEW FILE (${file.content.length} chars)`);
    }
  }

  // LOCAL BUILD VALIDATION: Run npm run build locally before deploying
  logger.log("\n[EDIT-WORKER] ========================================");
  logger.log("[EDIT-WORKER] PRE-DEPLOYMENT: LOCAL BUILD VALIDATION");
  logger.log("[EDIT-WORKER] ========================================");
  
  let validatedFiles = result.files;
  
  try {
    const buildValidationResult = await validateAndFixBuild(
      result.files,
      userDir,
      callLLM,
      appType,
      { maxIterations: 3, enableLocalBuildValidation: true }
    );
    
    logger.log(`[EDIT-WORKER] 📊 Local build validation completed:`);
    logger.log(`[EDIT-WORKER]    - Success: ${buildValidationResult.buildSuccess}`);
    logger.log(`[EDIT-WORKER]    - Iterations: ${buildValidationResult.iterations}`);
    logger.log(`[EDIT-WORKER]    - Errors fixed: ${buildValidationResult.errors.length}`);
    
    if (buildValidationResult.buildSuccess) {
      validatedFiles = buildValidationResult.files;
      logger.log("[EDIT-WORKER] ✅ Local build passed! Proceeding to Vercel deployment...");
    } else {
      logger.warn("[EDIT-WORKER] ⚠️ Local build failed after max iterations, proceeding anyway...");
      logger.log(`[EDIT-WORKER]    Last error: ${buildValidationResult.lastError?.substring(0, 200) || 'Unknown'}...`);
      validatedFiles = buildValidationResult.files;
    }
  } catch (buildError) {
    logger.error("[EDIT-WORKER] ❌ Local build validation failed with exception:", buildError);
    logger.log("[EDIT-WORKER] ⚠️ Continuing to Vercel deployment anyway...");
  }

  // PHASE 1: Write changes to disk
  logger.log("\n[EDIT-WORKER] ========================================");
  logger.log("[EDIT-WORKER] PHASE 1: WRITE TO DISK");
  logger.log("[EDIT-WORKER] ========================================");
  await writeFilesToDir(userDir, validatedFiles);
  await saveFilesToGenerated(projectId, validatedFiles);
  logger.log(`[EDIT-WORKER] ✅ ${validatedFiles.length} files written to disk`);

  // PHASE 2: Save to database
  logger.log("\n[EDIT-WORKER] ========================================");
  logger.log("[EDIT-WORKER] PHASE 2: SAVE TO DATABASE");
  logger.log("[EDIT-WORKER] ========================================");
  const safeFiles = validatedFiles.filter(file => {
    if (file.content.includes('\0') || file.content.includes('\x00')) {
      logger.log(`[EDIT-WORKER] ⚠️ Skipping file with null bytes: ${file.filename}`);
      return false;
    }
    return true;
  });

  logger.log(`[EDIT-WORKER] Saving ${safeFiles.length} files to database...`);
  await saveProjectFiles(projectId, safeFiles);
  logger.log("[EDIT-WORKER] ✅ Project files saved to database");
  
  // Verify files were saved
  const savedFilesCheck = await getProjectFiles(projectId);
  logger.log(`[EDIT-WORKER] ✅ Verification: ${savedFilesCheck.length} files now in database`);

  // Check if project has contracts (Web3) by looking for contracts directory
  const hasContracts = validatedFiles.some(f => 
    f.filename.startsWith('contracts/') && f.filename.endsWith('.sol')
  );
  const isWeb3 = hasContracts; // Whether contracts exist (for potential deployment)

  // PHASE 3: Redeploy to Vercel with retry loop for error fixing
  logger.log("\n[EDIT-WORKER] ========================================");
  logger.log("[EDIT-WORKER] PHASE 3: DEPLOY TO VERCEL (WITH RETRY)");
  logger.log("[EDIT-WORKER] ========================================");
  logger.log(`[EDIT-WORKER] Deploying ${validatedFiles.length} files to Vercel...`);
  
  let deploymentFailed = false;
  let deploymentError = '';
  let finalVercelUrl: string | undefined;
  
  // Retry loop configuration (same as initial generation)
  const maxDeploymentRetries = 4;
  let deploymentAttempt = 0;
  const errorHistory: string[] = [];
  let consecutiveSameErrorCount = 0;
  let stuckOnError = false;
  let deployableFiles = [...validatedFiles];

  while (deploymentAttempt < maxDeploymentRetries) {
    deploymentAttempt++;
    logger.log(`\n[EDIT-WORKER] 📦 Deployment attempt ${deploymentAttempt}/${maxDeploymentRetries}...`);
    
    try {
      const previewData = await redeployToVercel(
        projectId,
        deployableFiles,
        accessToken,
        appType,
        isWeb3,
        jobId
      );
      
      // Check if redeployToVercel returned deployment error info
      if (previewData.deploymentError) {
        logger.error(`[EDIT-WORKER] ❌ Deployment failed on attempt ${deploymentAttempt}`);
        logger.log(`[EDIT-WORKER] 📋 Deployment error: ${previewData.deploymentError.substring(0, 500)}...`);
        
        // Track consecutive same errors
        if (errorHistory.length > 0) {
          const lastError = errorHistory[errorHistory.length - 1];
          if (areErrorsSimilar(previewData.deploymentError, lastError)) {
            consecutiveSameErrorCount++;
            logger.log(`[EDIT-WORKER] 🔄 Same error detected! Consecutive count: ${consecutiveSameErrorCount}`);
          } else {
            consecutiveSameErrorCount = 1;
            logger.log(`[EDIT-WORKER] 🔄 Different error detected, resetting counter`);
          }
        } else {
          consecutiveSameErrorCount = 1;
        }
        errorHistory.push(previewData.deploymentError);
        
        // Check if stuck on same error
        if (consecutiveSameErrorCount >= MAX_CONSECUTIVE_SAME_ERROR_RETRIES) {
          logger.error(`[EDIT-WORKER] 🚫 Stuck on same error after ${consecutiveSameErrorCount} consecutive retries!`);
          stuckOnError = true;
          deploymentFailed = true;
          deploymentError = `Stuck on same error after ${consecutiveSameErrorCount} retries: ${previewData.deploymentError}`;
          break;
        }
        
        // Update job status for visibility
        await updateGenerationJobStatus(jobId, 'processing', {
          status: 'deployment_retry',
          attempt: deploymentAttempt,
          maxAttempts: maxDeploymentRetries,
          consecutiveSameErrorCount,
          error: previewData.deploymentError.substring(0, 500)
        });
        
        // If not the last attempt, try to fix errors
        if (deploymentAttempt < maxDeploymentRetries) {
          logger.log(`[EDIT-WORKER] 🔧 Attempting to fix deployment errors...`);
          
          const fixedFiles = await fixDeploymentErrors(
            previewData.deploymentError,
            previewData.deploymentLogs || '',
            deployableFiles,
            projectId,
            appType
          );
          
          logger.log(`[EDIT-WORKER] 🔍 fixDeploymentErrors returned ${fixedFiles.length} files`);
          
          // Update files with fixes
          deployableFiles = fixedFiles;
          
          // Write fixed files to disk and database
          await writeFilesToDir(userDir, deployableFiles);
          await saveFilesToGenerated(projectId, deployableFiles);
          await saveProjectFiles(projectId, deployableFiles);
          logger.log("[EDIT-WORKER] ✅ Fixed files saved, retrying deployment...");
          
          // Update job status
          await updateGenerationJobStatus(jobId, 'processing', {
            status: 'deployment_retrying',
            attempt: deploymentAttempt + 1,
            maxAttempts: maxDeploymentRetries,
            fixesApplied: true
          });
          
          continue; // Retry deployment
        } else {
          // Last attempt failed
          logger.error("[EDIT-WORKER] ❌ All deployment attempts failed");
          deploymentFailed = true;
          deploymentError = previewData.deploymentError;
          break;
        }
      }
      
      // Deployment succeeded!
      logger.log("[EDIT-WORKER] ✅ Vercel deployment successful!");
      logger.log(`[EDIT-WORKER] 🌐 Vercel URL: ${previewData.vercelUrl || 'N/A'}`);
      finalVercelUrl = previewData.vercelUrl;
      
      // Update validatedFiles with any fixes that were applied
      validatedFiles = deployableFiles;

      // Update project with deployment URL
      if (previewData.vercelUrl) {
        const project = await getProjectById(projectId);
        const urlChanged = project?.vercelUrl !== previewData.vercelUrl;
        
        if (urlChanged) {
          logger.log(`[EDIT-WORKER] ⚠️ Vercel URL changed: ${project?.vercelUrl} → ${previewData.vercelUrl}`);
        }
        
        await updateProject(projectId, {
          previewUrl: previewData.vercelUrl,
          vercelUrl: previewData.vercelUrl,
        });
        logger.log(`[EDIT-WORKER] ✅ Project URL updated in database: ${previewData.vercelUrl}`);
      }
      
      break; // Exit retry loop on success
      
    } catch (deployError) {
      const errorMessage = deployError instanceof Error ? deployError.message : String(deployError);
      logger.error(`[EDIT-WORKER] ❌ Deployment exception on attempt ${deploymentAttempt}:`, errorMessage);
      
      // Check if it's a timeout/network error that should trigger retry
      const isRetryableError = 
        errorMessage.includes('timeout') || 
        errorMessage.includes('ETIMEDOUT') || 
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('fetch failed');
      
      if (isRetryableError && deploymentAttempt < maxDeploymentRetries) {
        logger.log(`[EDIT-WORKER] ⏱️ Retryable error detected, retrying...`);
        await updateGenerationJobStatus(jobId, 'processing', {
          status: 'deployment_timeout',
          attempt: deploymentAttempt,
          maxAttempts: maxDeploymentRetries,
          error: errorMessage
        });
        continue;
      }
      
      // Non-retryable error or last attempt
      deploymentFailed = true;
      deploymentError = errorMessage;
      
      if (deploymentAttempt >= maxDeploymentRetries) {
        logger.error("[EDIT-WORKER] ❌ Max deployment attempts reached");
      }
      break;
    }
  }

  // Log final deployment status
  if (!deploymentFailed) {
    logger.log(`[EDIT-WORKER] 🎉 Deployment succeeded after ${deploymentAttempt} attempt(s)`);
  } else {
    logger.error(`[EDIT-WORKER] ❌ Deployment failed after ${deploymentAttempt} attempt(s)`);
    logger.log(`[EDIT-WORKER] 📋 Final error: ${deploymentError.substring(0, 300)}...`);
    if (stuckOnError) {
      logger.log(`[EDIT-WORKER] 🔄 Was stuck on same error: YES`);
    }
  }

  // Store patch for rollback (if diffs available and deployment succeeded)
  if (!deploymentFailed && hasDiffs && diffCount > 0) {
    try {
      const resultWithDiffs = result as unknown as { diffs: Array<{ filename: string }> };
      logger.log(`📦 Storing patch with ${diffCount} diffs for rollback`);
      const changedFiles = resultWithDiffs.diffs.map(d => d.filename);
      const description = `Updated ${changedFiles.length} file(s): ${changedFiles.join(', ')}`;

      await savePatch(projectId, {
        prompt,
        diffs: resultWithDiffs.diffs,
        changedFiles,
        timestamp: new Date().toISOString(),
      }, description);

      logger.log(`✅ Patch saved for rollback`);
    } catch (patchError) {
      logger.error("⚠️ Failed to save patch:", patchError);
      // Don't fail the job if patch save fails
    }
  }

  // If deployment failed, mark job as failed
  if (deploymentFailed) {
    logger.error("❌ Marking follow-up job as FAILED due to deployment error");
    
    // IMPORTANT: Include full project data so frontend can display files despite failure
    const errorResult = {
      success: false,
      projectId,
      deploymentError,
      deploymentFailed: true,
      status: 'deployment_failed',
      files: validatedFiles.map(f => ({ filename: f.filename })),
      diffs: hasDiffs ? (result as { diffs: unknown[] }).diffs : [],
      // Include these fields for frontend compatibility
      generatedFiles: validatedFiles.map(f => f.filename),
      previewUrl: getPreviewUrl(projectId),
      url: getPreviewUrl(projectId) || `https://${projectId}.${CUSTOM_DOMAIN_BASE}`,
      port: 3000,
    };
    
    try {
      await updateGenerationJobStatus(jobId, "failed", errorResult, deploymentError);
      logger.log(`✅ Follow-up job ${jobId} marked as FAILED in database`);
    } catch (updateError) {
      logger.error(`❌ Failed to update job status to failed:`, updateError);
      throw updateError;
    }
    
    // Send notification to user that deployment failed
    try {
      await notifyDeploymentFailed(job!.userId, projectId);
      logger.log(`📬 Deployment failure notification sent to user`);
    } catch (notifyError) {
      logger.warn(`⚠️ Failed to send deployment failure notification:`, notifyError);
    }
    
    // Throw error to prevent any "success" messaging
    throw new Error(`Deployment failed: ${deploymentError}`);
  }

  // Deployment succeeded - update job status to completed
  const changedFilenames = validatedFiles.map(f => f.filename);
  const jobResult = {
    success: true,
    projectId,
    files: validatedFiles.map(f => ({ filename: f.filename })),
    diffs: hasDiffs ? (result as { diffs: unknown[] }).diffs : [],
    changedFiles: changedFilenames,
    generatedFiles: changedFilenames, // Add this for frontend compatibility
    previewUrl: finalVercelUrl || getPreviewUrl(projectId),
    vercelUrl: finalVercelUrl, // Include the Vercel URL from deployment
    totalFiles: validatedFiles.length,
    appType, // Include appType for consistency
    deploymentAttempts: deploymentAttempt, // Track how many attempts it took
  };

  logger.log(`📝 Updating follow-up job ${jobId} status to completed`);

  try {
    await updateGenerationJobStatus(jobId, "completed", jobResult);
    logger.log(`✅ Follow-up job ${jobId} status updated to completed in database`);
  } catch (updateError) {
    logger.error(`❌ Failed to update follow-up job status:`, updateError);
    throw updateError;
  }

  // Send notification to user that edit deployment is complete
  try {
    const deploymentUrl = jobResult.previewUrl || getPreviewUrl(projectId) || '';
    await notifyEditComplete(job!.userId, projectId, deploymentUrl);
    logger.log(`📬 Edit complete notification sent to user`);
  } catch (notifyError) {
    logger.warn(`⚠️ Failed to send edit complete notification:`, notifyError);
    // Don't fail the job if notification fails
  }

  logger.log(`✅ Follow-up job ${jobId} completed successfully`);
}
