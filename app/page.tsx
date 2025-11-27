'use client';

import { useState, useEffect, useRef, useMemo } from 'react';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
import { CodeGenerator } from './components/CodeGenerator';
import { ChatInterface, ChatInterfaceRef } from './components/ChatInterface';
import { HoverSidebar, HoverSidebarRef } from './components/HoverSidebar';
import { UserProfileHeader } from './components/UserProfileHeader';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { useApiUtils } from '../lib/apiUtils';
import { EarnKit } from '@earnkit/earn';


interface GeneratedProject {
  projectId: string;
  port: number;
  url: string;
  generatedFiles?: string[];
  previewUrl?: string;
  vercelUrl?: string;
  aliasSuccess?: boolean;
  isNewDeployment?: boolean;
  hasPackageChanges?: boolean;
  appType?: 'farcaster';
}

function HomeContent() {
  const [currentProject, setCurrentProject] = useState<GeneratedProject | null>(null);
  const [projectForPreview, setProjectForPreview] = useState<GeneratedProject | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const { sessionToken } = useAuthContext();
  const { apiCall } = useApiUtils();
  const chatInterfaceRef = useRef<ChatInterfaceRef>(null);
  const hoverSidebarRef = useRef<HoverSidebarRef>(null);
  const previewDelayTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize EarnKit
  const activeAgent = useMemo(() => {
    const credsOff = process.env.NEXT_PUBLIC_CREDS_OFF === 'true';
    const agentId = process.env.NEXT_PUBLIC_EARNKIT_AGENT_ID;
    const apiKey = process.env.NEXT_PUBLIC_EARNKIT_API_KEY;
    
    console.log('🔧 EarnKit Initialization:', {
      credsOff,
      agentId: agentId ? `${agentId.substring(0, 8)}...` : 'missing',
      apiKey: apiKey ? `${apiKey.substring(0, 8)}...` : 'missing',
      hasAgentId: !!agentId,
      hasApiKey: !!apiKey
    });
    
    // If credits are disabled, return null to disable the credit system
    if (credsOff) {
      console.log('💰 Credits disabled via CREDS_OFF flag');
      return null;
    }
    
    if (!agentId || !apiKey) {
      console.warn('⚠️ EarnKit credentials not configured');
      return null;
    }

    console.log('✅ EarnKit instance created successfully');
    return new EarnKit({
      agentId,
      apiKey,
    });
  }, []);

  const feeModelType: "free-tier" | "credit-based" = "credit-based";
  
  console.log('📊 HomeContent render:', {
    hasActiveAgent: !!activeAgent,
    feeModelType,
    hasCurrentProject: !!currentProject
  });

  // Debug currentProject changes
  useEffect(() => {
    console.log('🏠 currentProject state changed to:', currentProject ? 'present' : 'null');
  }, [currentProject]);

  // Delay showing preview for new deployments to give Vercel time to deploy
  useEffect(() => {
    // Clear any existing timer
    if (previewDelayTimerRef.current) {
      clearTimeout(previewDelayTimerRef.current);
    }

    if (currentProject) {
      console.log('🔍 Project changed:', {
        projectId: currentProject.projectId,
        isNewDeployment: currentProject.isNewDeployment,
        hasVercelUrl: !!currentProject.vercelUrl,
        hasPreviewUrl: !!currentProject.previewUrl
      });

      // If it's a new deployment OR the project has a vercel/preview URL but we haven't shown it yet, wait
      // This handles both initial deployments and cases where deployment just completed
      const shouldWaitForDeployment = currentProject.isNewDeployment || 
        (currentProject.vercelUrl && !projectForPreview) || 
        (currentProject.previewUrl && !projectForPreview);

      if (shouldWaitForDeployment) {
        console.log('🕐 Deployment detected, waiting 10 seconds before showing preview...');
        previewDelayTimerRef.current = setTimeout(() => {
          console.log('✅ Preview delay complete, showing preview now');
          setProjectForPreview(currentProject);
        }, 10000); // Increased to 10 seconds for better reliability
      } else {
        // For existing projects or edits, show immediately
        console.log('📱 Showing preview immediately');
        setProjectForPreview(currentProject);
      }
    } else {
      // No project, clear preview
      console.log('🗑️ Clearing preview');
      setProjectForPreview(null);
    }

    // Cleanup timer on unmount
    return () => {
      if (previewDelayTimerRef.current) {
        clearTimeout(previewDelayTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject]);

  const handleProjectSelect = async (project: { id: string; name: string; description?: string; appType?: 'farcaster'; previewUrl?: string; vercelUrl?: string; createdAt: string; updatedAt: string }) => {
    try {
      console.log('🔍 handleProjectSelect called with project:', project);
      console.log('🔍 Attempting to fetch project with ID:', project.id);
      
      // Load project files and create a GeneratedProject object using apiCall
      const data = await apiCall<{ project: { id: string; name: string; description?: string; appType?: 'farcaster'; previewUrl?: string; vercelUrl?: string; files: unknown[]; chatMessages: unknown[] } }>(`/api/projects/${project.id}`, {
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('🔍 Project API response data:', data);
      const projectData = data.project;

      // Convert database project to GeneratedProject format
      const generatedProject: GeneratedProject = {
        projectId: projectData.id,
        port: 3000, // Default port
        url: projectData.vercelUrl || projectData.previewUrl || '',
        generatedFiles: (projectData.files as { filename: string }[])?.map((f: { filename: string }) => f.filename) || [],
        previewUrl: projectData.previewUrl,
        vercelUrl: projectData.vercelUrl,
        aliasSuccess: !!(projectData.vercelUrl || projectData.previewUrl),
        isNewDeployment: false,
        hasPackageChanges: false,
        appType: projectData.appType || 'farcaster', // Include appType from database
      };

      console.log('🔍 Generated project loaded:', {
        projectId: generatedProject.projectId,
        vercelUrl: generatedProject.vercelUrl,
        previewUrl: generatedProject.previewUrl,
        url: generatedProject.url,
        appType: generatedProject.appType,
      });

      setCurrentProject(generatedProject);
    } catch (error) {
      console.error('Error loading project:', error);
      // You might want to show an error message to the user
    }
  };

  const handleNewProject = () => {
    console.log('🆕 handleNewProject called - clearing current project');
    setCurrentProject(null);
    setProjectForPreview(null);
    
    // Clear any preview delay timer
    if (previewDelayTimerRef.current) {
      clearTimeout(previewDelayTimerRef.current);
      previewDelayTimerRef.current = null;
    }
    
    // Clear chat and focus input
    if (chatInterfaceRef.current) {
      chatInterfaceRef.current.clearChat();
      
      // Focus input after a short delay to ensure render is complete
      setTimeout(() => {
        chatInterfaceRef.current?.focusInput();
      }, 100);
    }
  };

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mobileViewMode, setMobileViewMode] = useState<'chat' | 'preview'>('chat');

  // Auto-switch to preview when generation starts
  useEffect(() => {
    if (isGenerating) {
      console.log('🚀 Generation started - switching to preview mode');
      setMobileViewMode('preview');
    }
  }, [isGenerating]);

  return (
    <div className="flex min-h-screen h-screen font-funnel-sans relative bg-white overflow-hidden">
      {/* Thin Permanent Sidebar */}
      <HoverSidebar
        ref={hoverSidebarRef}
        onProjectSelect={handleProjectSelect}
        onNewProject={handleNewProject}
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      {/* Main Content - Chat and Preview */}
      <div className={`flex flex-1 transition-all duration-300 flex-col md:flex-row overflow-hidden`}>
        {/* Left Section - Chat/Agent */}
        <section className={`w-full md:w-1/3 border-r border-gray-200 h-full flex flex-col bg-white overflow-hidden ${mobileViewMode === 'preview' ? 'hidden md:flex' : 'flex'}`}>
          {/* User Profile Header - positioned above chat only */}
          <UserProfileHeader 
            onOpenSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            activeAgent={activeAgent}
            feeModelType={feeModelType}
          />
          
          {/* Chat Interface */}
          <ChatInterface
            ref={chatInterfaceRef}
            currentProject={currentProject}
            onProjectGenerated={setCurrentProject}
            onGeneratingChange={setIsGenerating}
            activeAgent={activeAgent || undefined}
          />

          {/* Mobile Toggle Button */}
          <div className="md:hidden border-t border-gray-200 bg-white p-3">
            <div className="flex gap-2">
              <button
                onClick={() => setMobileViewMode('chat')}
                className={`flex-1 py-2.5 px-4 rounded-full font-medium text-sm transition-all ${
                  mobileViewMode === 'chat'
                    ? 'bg-[#fe6c12] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Chat
                </div>
              </button>
              <button
                onClick={() => setMobileViewMode('preview')}
                className={`flex-1 py-2.5 px-4 rounded-full font-medium text-sm transition-all ${
                  mobileViewMode === 'preview'
                    ? 'bg-[#fe6c12] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Preview
                </div>
              </button>
            </div>
          </div>
        </section>

        {/* Right Section - Code/Preview */}
        <section className={`w-full md:w-2/3 h-full bg-gray-50 transition-all duration-500 overflow-hidden flex flex-col ${mobileViewMode === 'chat' ? 'hidden md:flex' : 'flex'}`}>
          <div className="flex-1 overflow-hidden">
            <CodeGenerator
              currentProject={projectForPreview}
              isGenerating={isGenerating || (!!currentProject && !projectForPreview)}
              onOpenSidebar={() => hoverSidebarRef.current?.openSidebar()}
            />
          </div>
          
          {/* Mobile Toggle Button - Bottom of Preview Section */}
          <div className="md:hidden border-t border-gray-200 bg-white p-3 flex-shrink-0">
            <div className="flex gap-2">
              <button
                onClick={() => setMobileViewMode('chat')}
                className={`flex-1 py-2.5 px-4 rounded-full font-medium text-sm transition-all ${
                  mobileViewMode === 'chat'
                    ? 'bg-[#fe6c12] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Chat
                </div>
              </button>
              <button
                onClick={() => setMobileViewMode('preview')}
                className={`flex-1 py-2.5 px-4 rounded-full font-medium text-sm transition-all ${
                  mobileViewMode === 'preview'
                    ? 'bg-[#fe6c12] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Preview
                </div>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <ProtectedRoute>
        <HomeContent />
      </ProtectedRoute>
    </AuthProvider>
  );
}
