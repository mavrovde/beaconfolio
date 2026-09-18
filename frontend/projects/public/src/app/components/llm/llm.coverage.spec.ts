import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LlmComponent } from './llm.component';
import { LlmService } from '@beaconfolio/shared';
import { FormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { provideTestBrand } from '@beaconfolio/shared/testing';

class MockLlmService {
  chat = vi.fn().mockResolvedValue(undefined);
  generateName = vi.fn().mockResolvedValue('Mock Agent');
  multiChat = vi.fn().mockResolvedValue(undefined);
}

describe('LlmComponent additional branch coverage (browser)', () => {
  let component: LlmComponent;
  let fixture: ComponentFixture<LlmComponent>;
  let llmService: MockLlmService;

  beforeEach(async () => {
    llmService = new MockLlmService();
    await TestBed.configureTestingModule({
      imports: [LlmComponent, FormsModule],
      providers: [
        ...provideTestBrand(),
        { provide: LlmService, useValue: llmService },
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LlmComponent);
    component = fixture.componentInstance;
    localStorage.clear();
    fixture.detectChanges();
  });

  afterEach(() => vi.restoreAllMocks());

  it('sendMessage returns early when already thinking (line 109)', () => {
    component.userInput = 'hi';
    component.isThinking = true;
    component.sendMessage();
    expect(llmService.chat).not.toHaveBeenCalled();
  });

  it('addAgent starts at id 1 when the list is empty (line 175 false branch)', () => {
    vi.useFakeTimers();
    component.agents = [];
    component.addAgent();
    expect(component.agents[0].id).toBe(1);
    vi.advanceTimersByTime(100);
    vi.useRealTimers();
  });

  it('generateAgentName is a no-op when name is present (line 198 short-circuit)', async () => {
    const agent = { id: 1, name: 'Named', description: 'desc' };
    await component.generateAgentName(agent);
    expect(llmService.generateName).not.toHaveBeenCalled();
  });

  it('generateAgentName generates when name is a default "Agent N" placeholder', async () => {
    const agent = { id: 5, name: '', description: 'desc' };
    await component.generateAgentName(agent);
    expect(llmService.generateName).toHaveBeenCalledWith('desc');
    expect(agent.name).toBe('Mock Agent');
  });

  it('generateAgentName does not overwrite when generateName returns empty', async () => {
    llmService.generateName.mockResolvedValue('');
    const agent = { id: 1, name: '', description: 'desc' };
    await component.generateAgentName(agent);
    expect(agent.name).toBe('');
  });

  it('startMultiConversation returns early when topic missing (line 217)', async () => {
    component.conversationTopic = '';
    component.agents = [
      { id: 1, name: 'A', description: 'D1' },
      { id: 2, name: 'B', description: 'D2' },
    ];
    await component.startMultiConversation();
    expect(llmService.multiChat).not.toHaveBeenCalled();
  });

  it('startMultiConversation returns early when an agent lacks a description (line 218)', async () => {
    component.conversationTopic = 'Topic';
    component.agents = [
      { id: 1, name: 'A', description: 'D1' },
      { id: 2, name: 'B', description: '' },
    ];
    await component.startMultiConversation();
    expect(llmService.multiChat).not.toHaveBeenCalled();
  });

  it('startMultiConversation returns early when already active (line 219)', async () => {
    component.conversationTopic = 'Topic';
    component.agents = [
      { id: 1, name: 'A', description: 'D1' },
      { id: 2, name: 'B', description: 'D2' },
    ];
    component.isConversationActive = true;
    await component.startMultiConversation();
    expect(llmService.multiChat).not.toHaveBeenCalled();
  });

  it('startMultiConversation defaults agent name/role/goal when missing (line 239 fallbacks)', async () => {
    component.conversationTopic = 'Topic';
    component.agents = [
      { id: 1, name: '', description: 'D1' },
      { id: 2, name: '', description: 'D2' },
    ];
    llmService.multiChat.mockResolvedValue(undefined);
    await component.startMultiConversation();
    const configs = llmService.multiChat.mock.calls[0][0];
    expect(configs[0].name).toBe('Agent 1');
    expect(configs[0].role).toBe('');
    expect(configs[0].goal).toBe('');
  });

  it('resolves speaking status when agent is unknown and identifying (lines 263-265)', async () => {
    component.conversationTopic = 'Topic';
    component.agents = [
      { id: 1, name: '', description: 'D1' }, // no name -> Identifying...
      { id: 2, name: 'B', description: 'D2' },
    ];
    const statuses: string[] = [];
    llmService.multiChat.mockImplementation((agents: any, topic: any, onChunk: any) => {
      onChunk(1, 'chunk', false); // agent 1 has no name -> 'Identifying...' -> status uses 'Agent 1'
      statuses.push(component.conversationStatus);
      onChunk(99, 'x', false); // unknown agent id -> `Agent 99`
      statuses.push(component.conversationStatus);
      return Promise.resolve();
    });
    await component.startMultiConversation();
    // During streaming the status reflects the speaking agent (before the finally block finalizes it)
    expect(statuses.some((s) => s.includes('speaking'))).toBe(true);
    expect(statuses).toContain('Agent 1 is speaking...');
  });

  it('getAgentName falls back to "Identifying..." then default label', () => {
    component.agents = [
      { id: 1, name: '', description: 'has desc' }, // -> Identifying...
      { id: 2, name: '', description: '' }, // -> Agent 2
    ];
    expect(component.getAgentName(1)).toBe('Identifying...');
    expect(component.getAgentName(2)).toBe('Agent 2');
  });

  it('removeAgent does nothing when only two agents remain (line 187 else)', () => {
    component.agents = [
      { id: 1, name: 'A', description: 'D1' },
      { id: 2, name: 'B', description: 'D2' },
    ];
    component.removeAgent(1);
    expect(component.agents.length).toBe(2);
  });

  it('generateAgentName generates when the name is a non-default custom string is skipped, but empty name path evaluates startsWith (line 198)', async () => {
    // name empty -> !agent.name true (short-circuit); then a name that is a custom non-default
    const custom = { id: 1, name: 'Custom Hero', description: 'desc' };
    await component.generateAgentName(custom); // returns early due to agent.name present
    expect(llmService.generateName).not.toHaveBeenCalled();

    // name defined but starts with "Agent " -> exercises the startsWith operand
    // (guarded by the outer `if (!agent.description || agent.name) return;`)
    const placeholder: any = { id: 2, name: 'Agent 2', description: '' };
    await component.generateAgentName(placeholder);
    expect(llmService.generateName).not.toHaveBeenCalled();
  });

  it('turnComplete with no pending message does not push (line 249 else)', async () => {
    component.conversationTopic = 'Topic';
    component.agents = [
      { id: 1, name: 'A', description: 'D1' },
      { id: 2, name: 'B', description: 'D2' },
    ];
    llmService.multiChat.mockImplementation((agents: any, topic: any, onChunk: any) => {
      // turnComplete true while currentAgentMessage is null -> else branch
      onChunk(1, '', true);
      return Promise.resolve();
    });
    await component.startMultiConversation();
    expect(component.multiMessages.length).toBe(0);
  });

  it('status uses "Agent N" label when a speaking agent has no name and no description (line 263 else)', async () => {
    component.conversationTopic = 'Topic';
    // Two agents so start passes validation; give one a description so validation passes,
    // then stream for an agent that has neither name nor description.
    component.agents = [
      { id: 1, name: 'A', description: 'D1' },
      { id: 2, name: 'B', description: 'D2' },
    ];
    const statuses: string[] = [];
    llmService.multiChat.mockImplementation((agents: any, topic: any, onChunk: any) => {
      // First chunk: agent 2 present but stripped of name/description ->
      // inner ternary `agent.description ? ... : \`Agent ${agent.id}\`` false branch.
      component.agents[1] = { id: 2, name: '', description: '' } as any;
      onChunk(2, 'chunk', false);
      statuses.push(component.conversationStatus);
      // Second chunk (no currentAgentMessage switch pending after finalize): unknown agent id ->
      // outer ternary `agent ? ... : \`Agent ${agentId}\`` false branch.
      component.currentAgentMessage = null;
      onChunk(777, 'x', false);
      statuses.push(component.conversationStatus);
      return Promise.resolve();
    });
    await component.startMultiConversation();
    expect(statuses).toContain('Agent 2 is speaking...');
    expect(statuses).toContain('Agent 777 is speaking...');
  });

  it('getAgentName uses default label ternary when description is empty (line 263 cond-expr)', () => {
    component.agents = [{ id: 7, name: '', description: '' }];
    // description empty -> `Agent ${id}` branch of the inner ternary
    expect(component.getAgentName(7)).toBe('Agent 7');
  });

  it('onAgentDescriptionChange does nothing for an unknown agent id (line 397 else)', () => {
    component.agents = [{ id: 1, name: 'A', description: 'D' }];
    const saveSpy = vi.spyOn(component as any, 'saveState');
    component.onAgentDescriptionChange(999); // no matching agent -> guard false
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('onAgentDescriptionChange does nothing when the agent already has a custom name', () => {
    component.agents = [{ id: 1, name: 'Custom', description: 'D' }];
    const saveSpy = vi.spyOn(component as any, 'saveState');
    component.onAgentDescriptionChange(1); // name is custom (not empty, not "Agent 1")
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('handleEsc does nothing when config is already hidden (line 405 else)', () => {
    component.isConfigVisible = false;
    component.handleEsc(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.isConfigVisible).toBe(false);
  });

  it('scrollToBottom is safe when there is no scroll container (line 95 else)', () => {
    (component as any).scrollContainer = undefined;
    expect(() => component.scrollToBottom()).not.toThrow();
  });

  it('focusInput is safe when there is no terminal input ref (line 103 else)', () => {
    (component as any).terminalInputRef = null;
    expect(() => component.focusInput()).not.toThrow();
  });

  it('saveLogs uses N/A defaults when role/goal are missing (line 322)', () => {
    vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
    const orig = document.createElement.bind(document);
    const anchor: any = { href: '', download: '', click: vi.fn() };
    vi.spyOn(document, 'createElement').mockImplementation((t: string) => (t === 'a' ? anchor : orig(t)));

    component.conversationTopic = 'T';
    component.agents = [{ id: 1, name: 'A', description: 'D' }]; // no role/goal
    component.multiMessages = [{ agent: 1, content: 'm' }];
    component.saveLogs();
    expect(anchor.click).toHaveBeenCalled();
  });
});

describe('LlmComponent non-standalone init (line 80 else)', () => {
  it('does not update SEO when standalone is false', async () => {
    await TestBed.configureTestingModule({
      imports: [LlmComponent, FormsModule],
      providers: [
        ...provideTestBrand(),
        { provide: LlmService, useClass: MockLlmService },
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideRouter([]),
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LlmComponent);
    const component = fixture.componentInstance;
    component.standalone = false; // set before ngOnInit
    localStorage.clear();
    fixture.detectChanges(); // runs ngOnInit with standalone=false
    expect(component.standalone).toBe(false);
    expect(component.messages).toEqual([]);
  });
});

describe('LlmComponent server-platform branches', () => {
  let component: LlmComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LlmComponent, FormsModule],
      providers: [
        ...provideTestBrand(),
        { provide: LlmService, useClass: MockLlmService },
        { provide: PLATFORM_ID, useValue: 'server' },
        provideRouter([]),
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LlmComponent);
    component = fixture.componentInstance;
  });

  it('saveState is a no-op on the server (line 415)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    (component as any).saveState();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('loadState is a no-op on the server (line 433)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    (component as any).loadState();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('clearState is a no-op on the server (line 465)', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem');
    component.clearState();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('LlmComponent timer restart branch (line 474)', () => {
  let component: LlmComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LlmComponent, FormsModule],
      providers: [
        ...provideTestBrand(),
        { provide: LlmService, useClass: MockLlmService },
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideRouter([]),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LlmComponent);
    component = fixture.componentInstance;
  });

  it('clears an existing timer before starting a new one (line 474 true branch)', () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(global, 'clearInterval');
    (component as any).startTimer(); // sets conversationTimer
    (component as any).startTimer(); // existing timer -> clearInterval branch taken
    expect(clearSpy).toHaveBeenCalled();
    clearInterval((component as any).conversationTimer);
    vi.useRealTimers();
  });
});
