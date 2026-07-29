"use client";

import type { RepositoryResponse } from "@flawferret2/job-schemas";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const storageKey = "flawferret2.repositoryScopeId";
const scopedPaths = new Set(["/discover", "/features", "/jobs/new"]);

const repositoryLabel = (repository: RepositoryResponse) => `${repository.owner}/${repository.name}`;

const shouldScopePath = (pathname: string) =>
  scopedPaths.has(pathname) || pathname.startsWith("/features/");

type RepositoryScopeSelectorProps = {
  repositories: RepositoryResponse[];
};

export function RepositoryScopeSelector({ repositories }: RepositoryScopeSelectorProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const repositoryIdFromUrl = searchParams.get("repositoryId") ?? "";
  const [selectedRepositoryId, setSelectedRepositoryId] = useState(repositoryIdFromUrl);

  const selectedRepository = useMemo(
    () => repositories.find((repository) => repository.id === selectedRepositoryId) ?? null,
    [repositories, selectedRepositoryId],
  );

  useEffect(() => {
    const savedRepositoryId = localStorage.getItem(storageKey) ?? "";
    const savedRepositoryExists = repositories.some((repository) => repository.id === savedRepositoryId);

    if (repositoryIdFromUrl) {
      const urlRepositoryExists = repositories.some((repository) => repository.id === repositoryIdFromUrl);

      if (savedRepositoryExists && savedRepositoryId !== repositoryIdFromUrl && shouldScopePath(pathname)) {
        const params = new URLSearchParams(searchParams.toString());
        params.set("repositoryId", savedRepositoryId);
        setSelectedRepositoryId(savedRepositoryId);
        router.replace(`${pathname}?${params.toString()}`, {
          scroll: false,
        });
        return;
      }

      if (urlRepositoryExists) {
        localStorage.setItem(storageKey, repositoryIdFromUrl);
        setSelectedRepositoryId(repositoryIdFromUrl);
        return;
      }

      localStorage.removeItem(storageKey);
      setSelectedRepositoryId("");

      if (shouldScopePath(pathname)) {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("repositoryId");
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        });
      }

      return;
    }

    const nextRepositoryId = savedRepositoryExists ? savedRepositoryId : repositories[0]?.id ?? "";

    if (!nextRepositoryId) {
      localStorage.removeItem(storageKey);
      setSelectedRepositoryId("");
      return;
    }

    localStorage.setItem(storageKey, nextRepositoryId);
    setSelectedRepositoryId(nextRepositoryId);

    if (shouldScopePath(pathname)) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("repositoryId", nextRepositoryId);
      router.replace(`${pathname}?${params.toString()}`, {
        scroll: false,
      });
    }
  }, [pathname, repositories, repositoryIdFromUrl, router, searchParams]);

  const updateScope = (repositoryId: string) => {
    if (repositoryId === "__new__") {
      router.push("/repositories");
      return;
    }

    setSelectedRepositoryId(repositoryId);

    if (repositoryId) {
      localStorage.setItem(storageKey, repositoryId);
    } else {
      localStorage.removeItem(storageKey);
    }

    if (shouldScopePath(pathname)) {
      const params = new URLSearchParams(searchParams.toString());

      if (repositoryId) {
        params.set("repositoryId", repositoryId);
      } else {
        params.delete("repositoryId");
      }

      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    }
  };

  return (
    <section className="scope-card" aria-label="Repository scope">
      <div className="scope-card-copy">
        <span>Scope</span>
        {selectedRepository ? (
          <>
            <strong>{repositoryLabel(selectedRepository)}</strong>
            <small>Branch: {selectedRepository.defaultBranch}</small>
          </>
        ) : (
          <>
            <strong>No repository selected</strong>
            <small>Choose a repository to scope repo-aware pages.</small>
          </>
        )}
      </div>
      <label className="scope-card-select">
        <span>Change repository</span>
        <select
          aria-label="Repository scope"
          value={selectedRepositoryId}
          onChange={(event) => updateScope((event.currentTarget as unknown as { value: string }).value)}
        >
          <option value="">Select repository</option>
          {repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>
              {repositoryLabel(repository)}
            </option>
          ))}
          <option value="__new__">New repository...</option>
        </select>
      </label>
    </section>
  );
}
