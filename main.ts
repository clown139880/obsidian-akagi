import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	TFile,
	MarkdownView,
	Editor,
} from "obsidian";
import OSS from "ali-oss";

interface MyPluginSettings {
	githubToken: string;
	repoOwner: string;
	repoName: string;
	branch: string;
	ossAccessKeyId: string;
	ossAccessKeySecret: string;
	ossBucket: string;
	ossRegion: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	githubToken: "",
	repoOwner: "clown139880",
	repoName: "next-akagi",
	branch: "main",
	ossAccessKeyId: "",
	ossAccessKeySecret: "",
	ossBucket: "",
	ossRegion: "",
};

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// 添加右键菜单项
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				menu.addItem((item) => {
					item.setTitle("Akagi:发布选中内容")
						.setIcon("paper-plane")
						.onClick(() => {
							const selectedText = editor.getSelection();
							if (selectedText) {
								const metadata = this.generateMetadata();
								this.publishContent(
									`${metadata}\n${selectedText}`,
									`闲谈-${getNowDate()}`
								);
							} else {
								new Notice("No text selected");
							}
						});
				});
			})
		);

		this.addCommand({
			id: "publish-entire-article",
			name: "Akagi:发布全文",
			editorCallback: (editor, view) => {
				const entireText = editor.getValue();
				const metadata = this.extractMetadata(entireText);
				let content = this.stripMetadata(entireText);

				content = content
					.split("\n")
					.map((line) => {
						if (!line.endsWith("  ")) {
							return line + "  ";
						} else {
							return line;
						}
					})
					.join("\n");

				const fullContent = metadata
					? `${metadata}\n${content}`
					: this.generateMetadata(view.file?.basename) +
					  "\n" +
					  content;
				this.publishContent(
					fullContent,
					view.file?.basename || `闲谈-${getNowDate()}`,
					view.file
				);
			},
		});

		this.addCommand({
			id: "update-metadata",
			name: "Akagi:添加或更新元数据",
			editorCallback: (editor, view) => {
				const entireText = editor.getValue();
				const metadata = this.extractMetadata(entireText);
				const content = this.stripMetadata(entireText);
				const fullContent = metadata
					? `${metadata}\n${content}`
					: this.generateMetadata(view.file?.basename) +
					  "\n" +
					  content;

				this.updateLastMod(view.file!, fullContent);
			},
		});

		this.addSettingTab(new MyPluginSettingTab(this.app, this));

		// // 监听粘贴事件
		// this.registerDomEvent(document, "paste", (event: ClipboardEvent) => {
		// 	const editor =
		// 		this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		// 	if (editor) {
		// 		this.handlePaste(event, editor);
		// 	}
		// });
	}

	onunload() {
		console.log("Unloading my plugin");
	}

	async publishContent(
		content: string,
		filename: string,
		file?: TFile | null
	) {
		const filePath = `data/blog/${filename}.mdx`;
		const base64Content = Buffer.from(content).toString("base64");
		const url = `https://api.github.com/repos/${this.settings.repoOwner}/${this.settings.repoName}/contents/${filePath}`;

		const body = {
			message: `Add new blog post: ${filename}`,
			content: base64Content,
			branch: this.settings.branch,
			sha: undefined as string | undefined,
		};

		try {
			// 获取文件SHA，如果存在则进行更新
			const getResponse = await fetch(url, {
				method: "GET",
				headers: {
					Authorization: `token ${this.settings.githubToken}`,
					"Content-Type": "application/json",
				},
			});

			if (getResponse.ok) {
				const fileData = await getResponse.json();
				body.sha = fileData.sha;
			}

			const response = await fetch(url, {
				method: "PUT",
				headers: {
					Authorization: `token ${this.settings.githubToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});

			if (response.ok) {
				new Notice("Content published successfully");
				if (file) {
					this.updateLastMod(file, content);
				}
			} else {
				const error = await response.json();
				new Notice(`Failed to publish content: ${error.message}`);
			}
		} catch (error) {
			new Notice(`An error occurred: ${error.message}`);
		}
	}

	extractMetadata(content: string): string {
		const metadataMatch = content.match(/^---[\s\S]+?---/);
		return metadataMatch ? metadataMatch[0] : "";
	}

	stripMetadata(content: string): string {
		return content.replace(/^---[\s\S]+?---/, "").trim();
	}

	generateMetadata(title?: string): string {
		const now = new Date();
		const dateString = formatLocalDateTime(now);
		return `---
title: '${title || ""}'
date: '${dateString}'
lastmod: '${dateString}'
tags: ${title ? "[]" : "[闲谈]"}
draft: false
summary: ''
---`;
	}

	async updateLastMod(file: TFile, content: string) {
		const metadata = this.extractMetadata(content);
		const newLastMod = `lastmod: '${formatLocalDateTime(new Date())}'`;
		const updatedMetadata = metadata.replace(/lastmod: .*/, newLastMod);
		const updatedContent = `${updatedMetadata}\n${this.stripMetadata(
			content
		)}`;
		await this.app.vault.modify(file, updatedContent);
	}

	async handlePaste(event: ClipboardEvent, editor: Editor) {
		const items = event.clipboardData?.files;
		if (!items) return;

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			new Notice(`Pasting file: ${item.name} (${item.type})`);
			if (item.type.startsWith("image/")) {
				const imageUrl = await this.uploadImageToOSS(item).catch(
					(error) => {
						new Notice(`Failed to upload image: ${error.message}`);
						return null;
					}
				);
				if (imageUrl) {
					editor.replaceSelection(`![${item.name}](${imageUrl})`);
				}
				event.preventDefault();
			}
		}
	}

	async uploadImageToOSS(file: File): Promise<string | null> {
		const client = new OSS({
			region: this.settings.ossRegion,
			accessKeyId: this.settings.ossAccessKeyId,
			accessKeySecret: this.settings.ossAccessKeySecret,
			bucket: this.settings.ossBucket,
			secure: true,
		});
		(client as any).agent = (client as any).urllib.agent;
		(client as any).httpsAgent = (client as any).urllib.httpsAgent;

		const now = new Date();
		const year = now.getFullYear();
		const mon = String(now.getMonth() + 1).padStart(2, "0");

		const fileName = `/blog/${year}${mon}/${file.name}`;
		try {
			const result = await client.put(fileName, file);
			return result.url;
		} catch (error) {
			new Notice(`Failed to upload image: ${error.message}`);
			return null;
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class MyPluginSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl("h2", { text: "Settings for my plugin" });

		new Setting(containerEl)
			.setName("GitHub Token")
			.setDesc("Your GitHub Personal Access Token")
			.addText((text) =>
				text
					.setPlaceholder("Enter your GitHub token")
					.setValue(this.plugin.settings.githubToken)
					.onChange(async (value) => {
						this.plugin.settings.githubToken = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Repository Owner")
			.setDesc("The owner of the GitHub repository")
			.addText((text) =>
				text
					.setPlaceholder("Enter the repository owner")
					.setValue(this.plugin.settings.repoOwner)
					.onChange(async (value) => {
						this.plugin.settings.repoOwner = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Repository Name")
			.setDesc("The name of the GitHub repository")
			.addText((text) =>
				text
					.setPlaceholder("Enter the repository name")
					.setValue(this.plugin.settings.repoName)
					.onChange(async (value) => {
						this.plugin.settings.repoName = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Branch")
			.setDesc("The branch to commit changes to")
			.addText((text) =>
				text
					.setPlaceholder("Enter the branch name")
					.setValue(this.plugin.settings.branch)
					.onChange(async (value) => {
						this.plugin.settings.branch = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("OSS Access Key ID")
			.setDesc("Your OSS Access Key ID")
			.addText((text) =>
				text
					.setPlaceholder("Enter your OSS Access Key ID")
					.setValue(this.plugin.settings.ossAccessKeyId)
					.onChange(async (value) => {
						this.plugin.settings.ossAccessKeyId = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("OSS Access Key Secret")
			.setDesc("Your OSS Access Key Secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your OSS Access Key Secret")
					.setValue(this.plugin.settings.ossAccessKeySecret)
					.onChange(async (value) => {
						this.plugin.settings.ossAccessKeySecret = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("OSS Bucket")
			.setDesc("Your OSS Bucket Name")
			.addText((text) =>
				text
					.setPlaceholder("Enter your OSS Bucket Name")
					.setValue(this.plugin.settings.ossBucket)
					.onChange(async (value) => {
						this.plugin.settings.ossBucket = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("OSS Region")
			.setDesc("Your OSS Region")
			.addText((text) =>
				text
					.setPlaceholder("Enter your OSS Region")
					.setValue(this.plugin.settings.ossRegion)
					.onChange(async (value) => {
						this.plugin.settings.ossRegion = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

function getNowDate() {
	const now = new Date();

	// 获取年、月、日、小时、分钟、秒
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const hours = String(now.getHours()).padStart(2, "0");
	const minutes = String(now.getMinutes()).padStart(2, "0");
	const seconds = String(now.getSeconds()).padStart(2, "0");

	// 组合成需要的格式
	return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function formatLocalDateTime(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");

	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
