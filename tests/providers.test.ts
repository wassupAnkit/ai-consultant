import { describe, expect, test } from "bun:test";
import { ChatBedrockConverse } from "@langchain/aws";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { createAnswerModels, createResearchModel, DEEP_THINK_HEADROOM_TOKENS, OpenRouterChatModel, REASONING_HEADROOM_TOKENS } from "../src/llm/providers";
import { parseModelSpec } from "../src/llm/spec";
import { createChatModel, GEMINI_THINKING_HEADROOM_TOKENS } from "../src/llm/gemini";
import { testEnv } from "./helpers";

const DEEPSEEK = "openrouter:deepseek/deepseek-v4.1-flash";
const GLM = "bedrock:zai.glm-4.7-flash";

describe("model specs", () => {
  test("parses gemini and openrouter specs; rejects malformed ones", () => {
    expect(parseModelSpec(DEEPSEEK)).toEqual({ provider: "openrouter", model: "deepseek/deepseek-v4.1-flash", id: DEEPSEEK });
    expect(parseModelSpec("gemini:gemini-3.6-flash").provider).toBe("gemini");
    expect(() => parseModelSpec("deepseek")).toThrow(/expected gemini/);
    expect(() => parseModelSpec("openai:gpt-6")).toThrow(/unknown provider/);
    expect(() => parseModelSpec("openrouter:deepseek")).toThrow(/vendor\/model/);
    expect(parseModelSpec(GLM)).toEqual({ provider: "bedrock", model: "zai.glm-4.7-flash", id: GLM });
    expect(() => parseModelSpec("bedrock:")).toThrow(/invalid model spec/);
  });
});

describe("env validation for model settings", () => {
  test("an openrouter model without OPENROUTER_API_KEY stops the boot, naming the key", () => {
    expect(() => testEnv({ ANSWER_MODEL: DEEPSEEK })).toThrow(/OPENROUTER_API_KEY is required when ANSWER_MODEL/);
    expect(() => testEnv({ RESEARCH_MODEL: DEEPSEEK })).toThrow(/OPENROUTER_API_KEY is required when RESEARCH_MODEL/);
  });

  test("a bedrock model needs no key (IRSA supplies credentials) and defaults to Sydney", () => {
    const env = testEnv({ ANSWER_MODEL: GLM, RESEARCH_MODEL: GLM });
    expect(env.ANSWER_MODEL).toBe(GLM);
    expect(env.BEDROCK_REGION).toBe("ap-southeast-2");
    expect(testEnv({ BEDROCK_REGION: "us-east-1" }).BEDROCK_REGION).toBe("us-east-1");
  });

  test("a malformed spec or routing value stops the boot", () => {
    expect(() => testEnv({ ANSWER_MODEL: "deepseek-v4.1-flash", OPENROUTER_API_KEY: "k" })).toThrow(/invalid model spec/);
    expect(() => testEnv({ OPENROUTER_PROVIDER: "DeepInfra" })).toThrow(/OPENROUTER_PROVIDER must be a JSON object/);
    expect(testEnv({ OPENROUTER_PROVIDER: '{"only":["DeepInfra"]}' }).OPENROUTER_PROVIDER).toEqual({ only: ["DeepInfra"] });
  });
});

describe("answer and research models", () => {
  test("unset settings keep today's Gemini models", () => {
    const env = testEnv();
    const { primary, fallback } = createAnswerModels(env);
    expect(primary).toBeInstanceOf(ChatGoogleGenerativeAI);
    expect((primary as ChatGoogleGenerativeAI).model).toBe(env.GEMINI_MODEL);
    expect((fallback as ChatGoogleGenerativeAI).model).toBe(env.GEMINI_FALLBACK_MODEL);
    expect((createResearchModel(env) as ChatGoogleGenerativeAI).model).toBe(env.GEMINI_MODEL);
  });

  test("DeepSeek via OpenRouter for answers and research, pinned hosts, Gemini fallback kept", () => {
    const env = testEnv({ ANSWER_MODEL: DEEPSEEK, RESEARCH_MODEL: DEEPSEEK, OPENROUTER_API_KEY: "sk-or-test", OPENROUTER_PROVIDER: '{"only":["DeepInfra"],"require_parameters":true}' });
    const { primary, deep, fallback } = createAnswerModels(env);
    expect(primary).toBeInstanceOf(OpenRouterChatModel);
    const p = primary as OpenRouterChatModel;
    expect(p.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(p.modelKwargs).toEqual({ provider: { only: ["DeepInfra"], require_parameters: true }, usage: { include: true } });
    expect(p.maxTokens).toBe(env.LLM_MAX_OUTPUT_TOKENS + REASONING_HEADROOM_TOKENS);
    // The fallback stays on Gemini so an OpenRouter outage still produces an answer.
    expect(fallback).toBeInstanceOf(ChatGoogleGenerativeAI);
    expect((fallback as ChatGoogleGenerativeAI).model).toBe(env.GEMINI_FALLBACK_MODEL);
    const r = createResearchModel(env) as OpenRouterChatModel;
    expect(r).toBeInstanceOf(OpenRouterChatModel);
    expect(r.temperature).toBe(0);
    expect(r.maxTokens).toBe(1_024 + REASONING_HEADROOM_TOKENS);
    // Usage accounting on, so every response carries its cost (recorded per call in chat_turns.llm).
    expect(r.modelKwargs).toEqual({ provider: { only: ["DeepInfra"], require_parameters: true }, usage: { include: true } });
    expect((createResearchModel(testEnv({ RESEARCH_MODEL: DEEPSEEK, OPENROUTER_API_KEY: "k" })) as OpenRouterChatModel).modelKwargs).toEqual({ usage: { include: true } });
  });

  test("DeepThink: the same OpenRouter model at DEEP_THINK_EFFORT with more reasoning headroom, hosts still pinned", () => {
    const env = testEnv({ ANSWER_MODEL: DEEPSEEK, OPENROUTER_API_KEY: "sk-or-test", OPENROUTER_PROVIDER: '{"only":["DeepInfra"],"require_parameters":true}' });
    const deep = createAnswerModels(env).deep as OpenRouterChatModel;
    expect(deep).toBeInstanceOf(OpenRouterChatModel);
    expect(deep.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(deep.modelKwargs).toEqual({ provider: { only: ["DeepInfra"], require_parameters: true }, reasoning: { effort: "medium" }, usage: { include: true } });
    expect(deep.maxTokens).toBe(env.LLM_MAX_OUTPUT_TOKENS + DEEP_THINK_HEADROOM_TOKENS);
    expect((createAnswerModels(testEnv({ ANSWER_MODEL: DEEPSEEK, OPENROUTER_API_KEY: "k", DEEP_THINK_EFFORT: "high" })).deep as OpenRouterChatModel).modelKwargs).toEqual({ reasoning: { effort: "high" }, usage: { include: true } });
  });

  test("GLM 4.7 Flash on Bedrock for answers and research, Gemini fallback kept", () => {
    const env = testEnv({ ANSWER_MODEL: GLM, RESEARCH_MODEL: GLM, OPENROUTER_PROVIDER: '{"only":["DeepInfra"]}', ANSWER_REASONING: "off" });
    const { primary, deep, fallback } = createAnswerModels(env);
    expect(primary).toBeInstanceOf(ChatBedrockConverse);
    const p = primary as ChatBedrockConverse;
    expect(p.model).toBe("zai.glm-4.7-flash");
    expect(p.region).toBe("ap-southeast-2");
    expect(p.maxTokens).toBe(env.LLM_MAX_OUTPUT_TOKENS + REASONING_HEADROOM_TOKENS);
    // OpenRouter routing and reasoning switches are OpenRouter request fields; nothing of them reaches Bedrock.
    expect(p.additionalModelRequestFields).toBeUndefined();
    // HTTP/1.1: the SDK's default HTTP/2 handler gets no response under Bun.
    expect(p.client.config.requestHandler).toBeInstanceOf(NodeHttpHandler);
    // DeepThink: the same Bedrock model with the DeepThink headroom, never a Gemini model named after it.
    expect(deep).toBeInstanceOf(ChatBedrockConverse);
    expect((deep as ChatBedrockConverse).model).toBe("zai.glm-4.7-flash");
    expect((deep as ChatBedrockConverse).maxTokens).toBe(env.LLM_MAX_OUTPUT_TOKENS + DEEP_THINK_HEADROOM_TOKENS);
    // GLM on Bedrock reasons only at "high" (low and medium answer without reasoning, measured
    // 2026-10-12), so DeepThink asks for high whatever DEEP_THINK_EFFORT says; normal turns send nothing.
    expect((deep as ChatBedrockConverse).additionalModelRequestFields).toEqual({ reasoning_effort: "high" });
    expect((createAnswerModels(testEnv({ ANSWER_MODEL: GLM, DEEP_THINK_EFFORT: "low" })).deep as ChatBedrockConverse).additionalModelRequestFields).toEqual({ reasoning_effort: "high" });
    expect((createResearchModel(env) as ChatBedrockConverse).additionalModelRequestFields).toBeUndefined();
    expect(fallback).toBeInstanceOf(ChatGoogleGenerativeAI);
    expect((fallback as ChatGoogleGenerativeAI).model).toBe(env.GEMINI_FALLBACK_MODEL);
    const r = createResearchModel(env) as ChatBedrockConverse;
    expect(r).toBeInstanceOf(ChatBedrockConverse);
    expect(r.temperature).toBe(0);
    expect(r.maxTokens).toBe(1_024 + REASONING_HEADROOM_TOKENS);
  });

  test("DeepThink on Gemini: the answer model with thought summaries at thinking level HIGH", () => {
    const env = testEnv({ GEMINI_THINKING_ENABLED: "false" });
    const deep = createAnswerModels(env).deep as ChatGoogleGenerativeAI;
    expect(deep).toBeInstanceOf(ChatGoogleGenerativeAI);
    expect(deep.model).toBe(env.GEMINI_MODEL);
    // On even with GEMINI_THINKING_ENABLED off: DeepThink is the consultant asking for it.
    expect((deep as unknown as { thinkingConfig?: unknown }).thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: "HIGH" });
  });
});

describe("OpenRouter reasoning", () => {
  const model = () => new OpenRouterChatModel({ model: "deepseek/deepseek-v4.1-flash", apiKey: "k", configuration: { baseURL: "https://openrouter.invalid/api/v1" } });
  const raw = { id: "gen-1", choices: [{ index: 0 }] };

  test("a streamed delta's `reasoning` is kept as reasoning_content, apart from the answer text", () => {
    const chunk = model()._convertCompletionsDeltaToBaseMessageChunk({ role: "assistant", content: "", reasoning: "IELTS 6.5 overall, 5.5 writing: " }, raw, "assistant");
    expect(chunk.additional_kwargs.reasoning_content).toBe("IELTS 6.5 overall, 5.5 writing: ");
    expect(chunk.content).toBe("");
    const text = model()._convertCompletionsDeltaToBaseMessageChunk({ role: "assistant", content: "The UK" }, raw, "assistant");
    expect(text.additional_kwargs.reasoning_content).toBeUndefined();
    expect(text.content).toBe("The UK");
  });

  test("an invoked message keeps its reasoning; DeepSeek's native reasoning_content still wins", () => {
    const m = model()._convertCompletionsMessageToBaseMessage({ role: "assistant", content: "done", reasoning: "check fees first" } as never, raw as never);
    expect(m.additional_kwargs.reasoning_content).toBe("check fees first");
    const native = model()._convertCompletionsMessageToBaseMessage({ role: "assistant", content: "done", reasoning: "x", reasoning_content: "native" } as never, raw as never);
    expect(native.additional_kwargs.reasoning_content).toBe("native");
  });
});

describe("Gemini thinking headroom", () => {
  test("free-text roles get headroom on top of the role cap; the classifier keeps its plain cap", () => {
    const env = testEnv();
    expect(createChatModel(env, "answer").maxOutputTokens).toBe(env.LLM_MAX_OUTPUT_TOKENS + GEMINI_THINKING_HEADROOM_TOKENS);
    expect(createChatModel(env, "fallback").maxOutputTokens).toBe(env.LLM_MAX_OUTPUT_TOKENS + GEMINI_THINKING_HEADROOM_TOKENS);
    expect(createChatModel(env, "research").maxOutputTokens).toBe(1024 + GEMINI_THINKING_HEADROOM_TOKENS);
    expect(createChatModel(env, "classifier").maxOutputTokens).toBe(1024);
  });
});

describe("reasoning off for normal answers and research", () => {
  test("ANSWER_REASONING / RESEARCH_REASONING=off send reasoning.enabled=false; DeepThink keeps its effort", () => {
    const env = testEnv({ ANSWER_MODEL: DEEPSEEK, RESEARCH_MODEL: DEEPSEEK, OPENROUTER_API_KEY: "k", ANSWER_REASONING: "off", RESEARCH_REASONING: "off" });
    const models = createAnswerModels(env);
    expect((models.primary as OpenRouterChatModel).modelKwargs).toEqual({ reasoning: { enabled: false }, usage: { include: true } });
    expect((models.deep as OpenRouterChatModel).modelKwargs).toEqual({ reasoning: { effort: "medium" }, usage: { include: true } });
    expect((createResearchModel(env) as OpenRouterChatModel).modelKwargs).toEqual({ reasoning: { enabled: false }, usage: { include: true } });
  });
  test("default leaves reasoning to the model", () => {
    expect((createAnswerModels(testEnv({ ANSWER_MODEL: DEEPSEEK, OPENROUTER_API_KEY: "k" })).primary as OpenRouterChatModel).modelKwargs).toEqual({ usage: { include: true } });
  });
});
