import { DatabaseSync } from 'node:sqlite';
export class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');}
 prepare(sql){const db=this.db;return {bind(...args){return {async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const result=db.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};},_sql:sql,_args:args};},async first(){return db.prepare(sql).get()||null;},async all(){return {results:db.prepare(sql).all()};}};}
 async batch(statements){this.db.exec('BEGIN');try{const out=[];for(const s of statements){const result=this.db.prepare(s._sql).run(...s._args);out.push({meta:{changes:Number(result.changes)}});}this.db.exec('COMMIT');return out;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
