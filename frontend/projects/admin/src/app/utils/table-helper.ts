export class TableHelper<T> {
    // Original Data
    private allItems: T[] = [];

    // State
    filteredItems: T[] = [];
    paginatedItems: T[] = [];

    // Pagination
    pageSize = 10;
    currentPage = 1;
    totalPages = 1;

    // Sorting
    sortField: keyof T | null = null;
    sortDirection: 'asc' | 'desc' = 'asc';

    // Search
    searchText = '';
    searchFields: (keyof T)[] = [];

    constructor() { }

    setData(items: T[]) {
        this.allItems = items || [];
        this.applyProcess();
    }

    setSearch(text: string, fields: (keyof T)[]) {
        this.searchText = text;
        this.searchFields = fields;
        this.currentPage = 1; // Reset to first page on search
        this.applyProcess();
    }

    toggleSort(field: keyof T) {
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }
        this.applyProcess();
    }

    setPage(page: number) {
        if (page >= 1 && page <= this.totalPages) {
            this.currentPage = page;
            this.updateSlice();
        }
    }

    private applyProcess() {
        let result = [...this.allItems];

        // 1. Search
        if (this.searchText && this.searchFields.length > 0) {
            const lowerQuery = this.searchText.toLowerCase();
            result = result.filter(item => {
                return this.searchFields.some(field => {
                    const val = item[field];
                    if (val === null || val === undefined) return false;
                    return String(val).toLowerCase().includes(lowerQuery);
                });
            });
        }

        // 2. Sort
        if (this.sortField) {
            result.sort((a, b) => {
                // Rows are compared with relational `>` below; every sortable column
                // in practice is a string, number or ISO date string.
                const valA = a[this.sortField!] as string | number;
                const valB = b[this.sortField!] as string | number;

                if (valA === valB) return 0;

                const comparison = valA > valB ? 1 : -1;

                return this.sortDirection === 'asc' ? comparison : -comparison;
            });
        }

        this.filteredItems = result;
        this.totalPages = Math.ceil(this.filteredItems.length / this.pageSize) || 1;

        // Ensure current page is valid
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages;
        }

        this.updateSlice();
    }

    private updateSlice() {
        const start = (this.currentPage - 1) * this.pageSize;
        const end = start + this.pageSize;
        this.paginatedItems = this.filteredItems.slice(start, end);
    }
}
