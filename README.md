# Company Ticket System

This repository is created for the ticket sales system for the ODTÜ "Company" Musicals Community.

# Production

First attach a Heroku Postgres to the application on heroku. Then log in to the heroku cli on your terminal. 

```
export HEROKU_APP="company-ticket"
heroku run python manage.py migrate
heroku run python manage.py createsuperuser
```

## Mimarlık hall creation:

If for example the full capacity is 280 tickets.

Seats:
```
{"count": 280}
```

SeatPlan:
```
{"all": [{"count": 280}]}
```
