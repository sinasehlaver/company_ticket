# company_ticket

This repository is created for the ticket sales system for the ODTÜ "Company" Musicals Community.

# production

First attach a Heroku Postgres to the application on heroku. Then log in to the heroku cli on your terminal. 

```
export HEROKU_APP="company-ticket"
heroku run python manage.py migrate
heroku run python manage.py createsuperuser
```
