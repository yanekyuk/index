import fs from 'fs';
import path from 'path';

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  description: string;
  content: string;
}

interface Frontmatter {
  title?: string;
  date?: string;
  description?: string;
  [key: string]: string | undefined;
}

function parseFrontmatter(fileContents: string): { data: Frontmatter; content: string } {
  const lines = fileContents.split('\n');
  
  // Check if file starts with ---
  if (lines[0].trim() !== '---') {
    return { data: {}, content: fileContents };
  }
  
  // Find closing ---
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }
  
  if (endIndex === -1) {
    return { data: {}, content: fileContents };
  }
  
  // Parse frontmatter
  const frontmatterLines = lines.slice(1, endIndex);
  const data: Frontmatter = {};
  
  for (const line of frontmatterLines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      data[key] = value;
    }
  }
  
  // Get content after frontmatter
  const content = lines.slice(endIndex + 1).join('\n').trim();
  
  return { data, content };
}

function getPostsDirectory() {
  return path.join(process.cwd(), 'content', 'blog');
}

export function getAllPosts(): BlogPost[] {
  const postsDirectory = getPostsDirectory();
  
  if (!fs.existsSync(postsDirectory)) {
    return [];
  }
  
  const fileNames = fs.readdirSync(postsDirectory);
  const posts = fileNames
    .filter(fileName => fileName.endsWith('.md'))
    .map(fileName => {
      const slug = fileName.replace(/\.md$/, '');
      return getPostBySlug(slug);
    })
    .filter((post): post is BlogPost => post !== null)
    .sort((a, b) => (new Date(b.date).getTime() - new Date(a.date).getTime()));

  return posts;
}

export function getPostBySlug(slug: string): BlogPost | null {
  const postsDirectory = getPostsDirectory();
  const fullPath = path.join(postsDirectory, `${slug}.md`);
  
  if (!fs.existsSync(fullPath)) {
    return null;
  }

  const fileContents = fs.readFileSync(fullPath, 'utf8');
  const { data, content } = parseFrontmatter(fileContents);

  return {
    slug,
    title: data.title || 'Untitled',
    date: data.date || new Date().toISOString().split('T')[0],
    description: data.description || '',
    content,
  };
}

export function getAllPostSlugs(): string[] {
  const postsDirectory = getPostsDirectory();
  
  if (!fs.existsSync(postsDirectory)) {
    return [];
  }
  
  return fs.readdirSync(postsDirectory)
    .filter(fileName => fileName.endsWith('.md'))
    .map(fileName => fileName.replace(/\.md$/, ''));
}
