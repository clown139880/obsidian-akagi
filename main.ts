import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	TFile,
} from "obsidian";

interface MyPluginSettings {
	githubToken: string;
	repoOwner: string;
	repoName: string;
	branch: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	githubToken: "",
	repoOwner: "clown139880",
	repoName: "next-akagi",
	branch: "main",
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
		};

		try {
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
		const dateString = now
			.toISOString()
			.replace(/T/, " ")
			.replace(/\..+/, "");
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
		const newLastMod = `lastmod: '${new Date()
			.toISOString()
			.replace(/T/, " ")
			.replace(/\..+/, "")}'`;
		const updatedMetadata = metadata.replace(/lastmod: .*/, newLastMod);
		const updatedContent = `${updatedMetadata}\n${this.stripMetadata(
			content
		)}`;
		await this.app.vault.modify(file, updatedContent);
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
