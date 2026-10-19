import {
	getFrontMatterInfo,
	Notice,
	Plugin,
	PluginSettingTab,
	parseYaml,
	Setting,
	TFile,
	TFolder,
} from "obsidian";

/** Preferências persistidas no Obsidian; mudanças são aplicadas nos próximos eventos ou na sincronização manual. */
interface Settings {
	automatic: boolean;
	excludedFolders: string;
	rootTag: boolean;
}

const DEFAULTS: Settings = {
	automatic: true,
	excludedFolders: "_system/",
	rootTag: false,
};
const NO_CHANGE = Symbol("no frontmatter changes");

/**
 * Verifica se o valor pode representar uma tag sem transformar o caminho original.
 * Rejeita segmentos vazios, espaços e tags inteiramente numéricas.
 * Por exemplo, "Estudos/Golang" é aceito; "Meus Estudos/Golang" é preservado sem conversão.
 */
function validTag(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[\p{L}\p{M}\p{N}\p{S}_-]+(?:\/[\p{L}\p{M}\p{N}\p{S}_-]+)*$/u.test(
			value,
		) &&
		/[^\p{N}/]/u.test(value)
	);
}

/** Restringe dados externos a um objeto de propriedades, excluindo listas e null. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Calcula as mudanças sem alterar o frontmatter recebido; retorna null se nada mudou.
 * Somente o registro reservado válido permite remover uma tag com grafia idêntica.
 * Uma tag de destino já existente é preservada sem assumir sua propriedade.
 * Exemplo: ao mover de "Estudos/Go" para "Trabalho/Go", substitui apenas a tag
 * comprovadamente gerenciada e mantém tags manuais como "Estudos" ou "favoritos".
 * Um destino null limpa somente a tag gerenciada e seu registro de propriedade.
 * Estruturas inesperadas interrompem o planejamento antes de qualquer escrita.
 */
function plan(frontmatter: Record<string, unknown>, target: string | null) {
	const rawTags = frontmatter.tags;
	if (
		rawTags !== undefined &&
		(!Array.isArray(rawTags) ||
			!rawTags.every((tag: unknown) => typeof tag === "string"))
	) {
		throw new Error("Unexpected tags structure; expected a list of strings.");
	}
	const previous = frontmatter.auto_path_hierarchical_tags_obsidian;
	if (previous !== undefined && !validTag(previous)) {
		throw new Error(
			"Invalid auto_path_hierarchical_tags_obsidian; ownership cannot be verified.",
		);
	}
	const tags: string[] = rawTags === undefined ? [] : [...rawTags];
	let owner: string | undefined = previous;
	if (previous !== undefined && previous !== target) {
		// Exige grafia exata: uma mudança manual de capitalização não comprova propriedade.
		const index = tags.indexOf(previous);
		if (index !== -1) tags.splice(index, 1);
		owner = undefined;
	}
	if (target !== null) {
		const exists = tags.some(
			(tag) => tag.replace(/^#/, "").toLowerCase() === target.toLowerCase(),
		);
		if (!exists) {
			tags.push(target);
			owner = target;
		}
		// Tags manuais existentes não são assumidas, mesmo quando correspondem ao diretório.
	}
	const changed =
		owner !== previous ||
		tags.length !== (rawTags?.length ?? 0) ||
		tags.some((tag, index) => tag !== rawTags?.[index]);
	return changed ? { tags, owner } : null;
}

/**
 * Integra o ciclo de vida do Obsidian à sincronização segura das tags de diretório.
 * Centraliza configurações, eventos e escritas serializadas por nota.
 */
export default class HierarchicalTagsPlugin extends Plugin {
	config: Settings = { ...DEFAULTS };
	private readonly pending = new Map<TFile, Promise<void>>();
	private stopped = false;

	/**
	 * Carrega preferências com validação, registra o comando e adiciona a aba de configurações.
	 * Aguarda o layout para registrar eventos: o carregamento inicial do Vault também
	 * emite eventos de criação, que não devem disparar uma sincronização completa.
	 * Movimentações de pastas incluem descendentes; renomear só a nota é ignorado.
	 */
	override async onload() {
		const saved: unknown = await this.loadData();
		if (isRecord(saved)) {
			this.config = {
				automatic:
					typeof saved.automatic === "boolean"
						? saved.automatic
						: DEFAULTS.automatic,
				excludedFolders:
					typeof saved.excludedFolders === "string"
						? saved.excludedFolders
						: DEFAULTS.excludedFolders,
				rootTag:
					typeof saved.rootTag === "boolean" ? saved.rootTag : DEFAULTS.rootTag,
			};
		}
		this.addSettingTab(new HierarchicalTagsSettings(this.app, this));
		this.addCommand({
			id: "synchronize-hierarchical-tags",
			name: "Synchronize hierarchical tags",
			callback: () => {
				void this.synchronizeVault();
			},
		});
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			this.registerEvent(
				this.app.vault.on("create", (file) => {
					if (this.config.automatic && file instanceof TFile)
						void this.enqueue(file);
				}),
			);
			this.registerEvent(
				this.app.vault.on("rename", (file, oldPath) => {
					if (!this.config.automatic) return;
					if (file instanceof TFile) {
						if (
							file.path.slice(0, file.path.lastIndexOf("/") + 1) !==
							oldPath.slice(0, oldPath.lastIndexOf("/") + 1)
						)
							void this.enqueue(file);
						return;
					}
					if (file instanceof TFolder) {
						for (const note of this.app.vault.getMarkdownFiles()) {
							if (note.path.startsWith(`${file.path}/`))
								void this.enqueue(note);
						}
					}
				}),
			);
		});
	}

	/** Impede novos trabalhos pendentes; o Obsidian remove os eventos registrados automaticamente. */
	override onunload() {
		this.stopped = true;
	}

	/**
	 * Encadeia operações pela identidade do arquivo, que permanece a mesma ao movê-lo.
	 * Eventos simultâneos da mesma nota aguardam a operação anterior, evitando escritas
	 * concorrentes. Ignora arquivos não Markdown, removidos ou com plugin desativado.
	 * Registra falhas sem bloquear as próximas notas e libera a entrada ao terminar.
	 */
	private enqueue(file: TFile): Promise<void> {
		if (file.extension.toLowerCase() !== "md") return Promise.resolve();
		const previous = this.pending.get(file) ?? Promise.resolve();
		const next = previous
			.then(async () => {
				if (
					this.stopped ||
					this.app.vault.getAbstractFileByPath(file.path) !== file
				)
					return;
				await this.synchronizeFile(file);
			})
			.catch((error: unknown) => {
				console.warn(`[hierarchical-tags-obsidian] ${file.path}`, error);
			});
		this.pending.set(file, next);
		void next.then(() => {
			if (this.pending.get(file) === next) this.pending.delete(file);
		});
		return next;
	}

	/**
	 * Obtém a tag do diretório atual respeitando exclusões e a opção de raiz.
	 * "_system/" exclui "_system/templates", mas não "_system-extra".
	 * Retorna null quando nenhuma tag é desejada; caminhos inválidos lançam erro
	 * para impedir inclusive a remoção destrutiva de uma tag anterior.
	 */
	private targetTag(file: TFile): string | null {
		const directory = file.parent?.path ?? "/";
		const excluded = this.config.excludedFolders
			.split(/\r?\n/)
			.map((path) => path.trim().replace(/^\/+|\/+$/g, ""))
			.filter(Boolean);
		if (
			excluded.some(
				(path) => directory === path || directory.startsWith(`${path}/`),
			)
		)
			return null;
		if (directory === "/") return this.config.rootTag ? "root" : null;
		if (!validTag(directory))
			throw new Error(
				`Directory cannot be represented safely as a tag: ${directory}`,
			);
		return directory;
	}

	/**
	 * Lê o YAML atual e verifica se há mudanças antes de solicitar uma escrita.
	 * Recalcula o plano dentro de processFrontMatter para considerar dados mais recentes.
	 * Altera somente tags e o registro reservado; a API preserva o corpo da nota,
	 * embora possa reformatar o YAML. NO_CHANGE aborta a escrita se o plano ficar vazio
	 * ou o plugin for desativado enquanto a operação aguarda.
	 */
	private async synchronizeFile(file: TFile) {
		const target = this.targetTag(file);
		const content = await this.app.vault.read(file);
		const info = getFrontMatterInfo(content);
		const parsed: unknown = info.exists ? parseYaml(info.frontmatter) : {};
		const frontmatter: unknown = parsed ?? {};
		if (!isRecord(frontmatter))
			throw new Error("Frontmatter must be a YAML mapping.");
		if (!plan(frontmatter, target)) return;
		try {
			await this.app.fileManager.processFrontMatter(
				file,
				(current: Record<string, unknown>) => {
					if (this.stopped) throw NO_CHANGE;
					// Recalcula com frontmatter e caminho atuais, sem depender do cache de metadados.
					const changes = plan(current, this.targetTag(file));
					if (!changes) throw NO_CHANGE;
					current.tags = changes.tags;
					if (changes.owner === undefined)
						delete current.auto_path_hierarchical_tags_obsidian;
					else current.auto_path_hierarchical_tags_obsidian = changes.owner;
				},
			);
		} catch (error) {
			if (error !== NO_CHANGE) throw error;
		}
	}

	/**
	 * Sincroniza manualmente todas as notas Markdown, independentemente da opção automática.
	 * Aguarda cada nota para limitar o trabalho no Vault e reutiliza a serialização
	 * dos eventos. Falhas individuais são registradas no console por enqueue.
	 */
	private async synchronizeVault() {
		new Notice("Synchronizing hierarchical tags…");
		for (const file of this.app.vault.getMarkdownFiles())
			await this.enqueue(file);
		new Notice(
			"Hierarchical tags synchronization finished. Check the console for skipped notes or errors.",
		);
	}
}

/** Exibe as três preferências do MVP e persiste cada mudança pela API do Obsidian. */
class HierarchicalTagsSettings extends PluginSettingTab {
	/** Vincula a aba ao aplicativo e à instância que mantém as configurações em uso. */
	constructor(
		app: Plugin["app"],
		private readonly plugin: HierarchicalTagsPlugin,
	) {
		super(app, plugin);
	}

	/**
	 * Reconstrói os controles com os valores atuais sempre que a aba é aberta.
	 * Salvar uma preferência não inicia varreduras: notas existentes são atualizadas
	 * pelo comando manual ou por um próximo evento aplicável.
	 */
	override display() {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl)
			.setName("Automatic updates")
			.setDesc(
				"Update newly created and moved Markdown notes. Does not scan the vault on startup.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.config.automatic)
					.onChange(async (value) => {
						this.plugin.config.automatic = value;
						await this.plugin.saveData(this.plugin.config);
					}),
			);
		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc(
				"Vault-relative paths, one per line. Includes descendants. Synchronization only removes a previously managed tag here.",
			)
			.addTextArea((text) =>
				text
					.setValue(this.plugin.config.excludedFolders)
					.onChange(async (value) => {
						this.plugin.config.excludedFolders = value;
						await this.plugin.saveData(this.plugin.config);
					}),
			);
		new Setting(containerEl).setName("Root behavior").addDropdown((dropdown) =>
			dropdown
				.addOption("none", "No tag")
				.addOption("root", "root")
				.setValue(this.plugin.config.rootTag ? "root" : "none")
				.onChange(async (value) => {
					this.plugin.config.rootTag = value === "root";
					await this.plugin.saveData(this.plugin.config);
				}),
		);
	}
}
